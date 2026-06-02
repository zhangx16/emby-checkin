#!/usr/bin/env python3

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pyrogram.types import Message

from embykeeper.telegram.pyrogram import Client
from embykeeper.telegram.session import API_ID, API_HASH

PROJECT_ROOT = Path(os.environ.get("CHECKIN_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = PROJECT_ROOT / "data"
FORM_FILE = DATA_DIR / "embykeeper" / "form.json"
CACHE_FILE = DATA_DIR / "embykeeper" / "runtime" / "cache.json"
SKIP_CACHE_FILE = DATA_DIR / "telegram_bot_checkin_skip.json"
REQUEST_TIMEOUT = 5
MESSAGE_TIME_SLOP = timedelta(seconds=2)
DEFAULT_BUTTON_HINTS = [
    "签到", "簽到", "打卡", "领取", "我不是机器人", "不是机器人", "点击签到", "立即签到"
]
GYMEOW_VERIFY_HINT = "请先验证你不是机器人"
GYMEOW_VERIFY_BUTTON = "✅ 我不是机器人"
GYMEOW_SIGNIN_BUTTON = "🎯 签到"
SKIP_HINTS = [
    "无权",
    "未注册",
    "尚未绑定账户",
    "还没有绑定账号",
    "请先完成绑定或注册",
    "进行绑定",
    "点击绑定账户",
    "请先点击下面加入我们的群组和频道",
    "无法使用本bot",
    "请先加入",
    "请先关注"
]


def load_json(path: Path, fallback: Any):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback


def normalize_string_list(value, fallback=None):
    fallback = fallback or []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [line.strip() for line in value.splitlines() if line.strip()]
    return list(fallback)


def load_form():
    raw = load_json(FORM_FILE, {})
    accounts = []
    for item in raw.get("telegramAccounts", []):
        phone = str(item.get("phone", "")).strip()
        if not phone:
            continue
        accounts.append({
            "phone": phone,
            "apiId": str(item.get("apiId", "")).strip(),
            "apiHash": str(item.get("apiHash", "")).strip(),
            "enabled": item.get("enabled", True) is not False,
            "checkiner": item.get("checkiner", True) is not False
        })

    bots = []
    for item in raw.get("botTemplates", []):
        bot_username = str(item.get("botUsername", "")).strip().lstrip("@")
        if not bot_username:
            continue
        bots.append({
            "botUsername": bot_username,
            "name": str(item.get("name", "")).strip() or bot_username,
            "commands": normalize_string_list(item.get("commands"), ["/checkin"]),
            "successKeywords": normalize_string_list(item.get("successKeywords"), ["签到成功", "今日已签到", "success"]),
            "checkedKeywords": normalize_string_list(item.get("checkedKeywords"), ["今日已签到", "今天已经签到过了"]),
            "failKeywords": normalize_string_list(item.get("failKeywords"), ["失败", "错误", "error", "invalid"]),
            "textIgnore": normalize_string_list(item.get("textIgnore"), []),
            "targetPhones": normalize_string_list(item.get("targetPhones") or item.get("target_phones"), []),
            "sendInterval": max(1, int(item.get("sendInterval", 3) or 3)),
            "isChat": bool(item.get("isChat", False)),
            "waitResponse": item.get("waitResponse", True) is not False
        })

    return accounts, bots


def load_session_strings():
    cache = load_json(CACHE_FILE, {})
    return cache.get("telegram", {}).get("session_str", {}) or {}


def load_skip_cache():
    data = load_json(SKIP_CACHE_FILE, {})
    return data if isinstance(data, dict) else {}


def save_skip_cache(data):
    SKIP_CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def should_skip_bot(skip_cache: dict, phone: str, bot_username: str):
    return bool(skip_cache.get(phone, {}).get(bot_username))


def set_skip_reason(skip_cache: dict, phone: str, bot_username: str, reason: str):
    skip_cache.setdefault(phone, {})[bot_username] = {
        "reason": str(reason or "").strip(),
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }


def clear_skip_reason(skip_cache: dict, phone: str, bot_username: str):
    if phone in skip_cache and bot_username in skip_cache[phone]:
        skip_cache[phone].pop(bot_username, None)
        if not skip_cache[phone]:
            skip_cache.pop(phone, None)


def find_session_string(phone: str, session_map: dict[str, str]):
    for key, value in session_map.items():
        if key.startswith(f"{phone}/") and value:
            return value
    return ""


def format_result_line(phone: str, bot_name: str, result: dict):
    label = (
        "跳过" if result.get("skipped")
        else "成功" if result.get("ok") and not result.get("already")
        else "已签" if result.get("already")
        else "失败"
    )
    return f"- {phone} · {bot_name}: {label} · {result.get('message', '')}"


def format_result_label(result: dict):
    return (
        "跳过" if result.get("skipped")
        else "已签" if result.get("already")
        else "成功" if result.get("ok")
        else "失败"
    )


async def click_matching_button(message: Message):
    if not message.reply_markup:
        return {"clicked": False, "answer": ""}

    keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
    for row in keyboard:
        for button in row:
            text = str(getattr(button, "text", "")).strip()
            if not text:
                continue
            if any(hint in text for hint in DEFAULT_BUTTON_HINTS):
                try:
                    result = await asyncio.wait_for(message.click(text, timeout=5), timeout=8)
                    answer = str(getattr(result, "message", "") or "").strip()
                    return {"clicked": True, "answer": answer}
                except Exception:
                    return {"clicked": False, "answer": ""}
    return {"clicked": False, "answer": ""}


async def refetch_message(client: Client, chat_id, message_id: int):
    try:
        messages = await client.get_messages(chat_id, message_id)
    except Exception:
        return None

    if isinstance(messages, list):
        return messages[0] if messages else None
    return messages


def evaluate_message(text: str, bot: dict):
    content = str(text or "").strip()
    lowered = content.lower()
    if not content:
        return None

    if any(keyword in content for keyword in bot["textIgnore"]):
        return None

    if any(keyword in content for keyword in SKIP_HINTS):
        return {"ok": True, "already": False, "skipped": True, "message": content}

    if any(keyword.lower() in lowered for keyword in bot["checkedKeywords"]):
        return {"ok": True, "already": True, "skipped": False, "message": content}

    if any(keyword.lower() in lowered for keyword in bot["successKeywords"]):
        return {"ok": True, "already": False, "skipped": False, "message": content}

    if any(keyword.lower() in lowered for keyword in bot["failKeywords"]):
        return {"ok": False, "already": False, "skipped": False, "message": content}

    return None


async def run_gymeow_checkin(client: Client, bot: dict):
    target = bot["botUsername"]
    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP

    await client.send_message(target, "/start")
    await asyncio.sleep(bot["sendInterval"])

    menu_message = None
    verify_message = None
    for _ in range(6):
        async for message in client.get_chat_history(target, limit=8):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue
            message_text = message.text or message.caption or ""
            if GYMEOW_VERIFY_HINT in message_text:
                verify_message = message
                break
            texts = []
            if message.reply_markup and getattr(message.reply_markup, "inline_keyboard", None):
                for row in message.reply_markup.inline_keyboard:
                    texts.extend([str(btn.text or "").strip() for btn in row])
            if GYMEOW_SIGNIN_BUTTON in texts:
                menu_message = message
                break
        if menu_message or verify_message:
            break
        await asyncio.sleep(1)

    if menu_message and not verify_message:
        try:
            await asyncio.wait_for(menu_message.click(GYMEOW_SIGNIN_BUTTON, timeout=1), timeout=2)
        except Exception:
            pass
        for _ in range(8):
            async for message in client.get_chat_history(target, limit=10):
                if message.outgoing:
                    continue
                if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                    continue
                message_text = message.text or message.caption or ""
                if GYMEOW_VERIFY_HINT in message_text:
                    verify_message = message
                    break
            if verify_message:
                break
            await asyncio.sleep(1)

    if not verify_message:
        return {"ok": False, "already": False, "skipped": False, "message": "未找到签到菜单或验证卡片"}

    try:
        verify_result = await asyncio.wait_for(verify_message.click(GYMEOW_VERIFY_BUTTON, timeout=3), timeout=5)
        verify_answer = str(getattr(verify_result, "message", "") or "").strip()
        if verify_answer:
            evaluated = evaluate_message(verify_answer, bot)
            if evaluated:
                return evaluated
    except Exception:
        pass

    for _ in range(8):
        async for message in client.get_chat_history(target, limit=10):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue
            result = evaluate_message(message.text or message.caption or "", bot)
            if result:
                return result
        await asyncio.sleep(1)

    return {"ok": False, "already": False, "skipped": False, "message": "等待 Bot 回复超时"}


async def run_single_bot(client: Client, bot: dict):
    target = bot["botUsername"]
    if target == "gymeowfly_bot":
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_gymeow_checkin(client, bot)
        print(
            f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
            flush=True
        )
        return result

    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP
    seen_ids = set()
    last_result = None
    clicked_keys = set()
    gymeow_sign_triggered = False

    print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)

    for command in bot["commands"]:
        if command:
            await client.send_message(target, command)
            await asyncio.sleep(bot["sendInterval"])

    if not bot["waitResponse"]:
        return {"ok": True, "already": False, "skipped": False, "message": "签到命令已发送"}

    bot_timeout = 12 if bot["botUsername"] == "gymeowfly_bot" else REQUEST_TIMEOUT
    deadline = asyncio.get_event_loop().time() + bot_timeout
    while asyncio.get_event_loop().time() < deadline:
        messages = []
        async for message in client.get_chat_history(target, limit=12):
            if message.id in seen_ids:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue
            if message.outgoing:
                continue
            messages.append(message)

        messages.sort(key=lambda item: item.id)
        for message in messages:
            seen_ids.add(message.id)
            message_text = message.text or message.caption or ""
            button_texts = []
            if message.reply_markup and getattr(message.reply_markup, "inline_keyboard", None):
                for row in message.reply_markup.inline_keyboard:
                    button_texts.extend([str(btn.text or "").strip() for btn in row])

            if bot["botUsername"] == "gymeowfly_bot" and GYMEOW_VERIFY_HINT in message_text:
                try:
                    verify_result = await asyncio.wait_for(message.click(GYMEOW_VERIFY_BUTTON, timeout=3), timeout=5)
                    verify_answer = str(getattr(verify_result, "message", "") or "").strip()
                    if verify_answer:
                        answer_result = evaluate_message(verify_answer, bot)
                        if answer_result:
                            print(
                                f"[{client.phone_number}] {bot['name']} -> {format_result_label(answer_result)}: {answer_result.get('message', '')}",
                                flush=True
                            )
                            return answer_result
                    await asyncio.sleep(bot["sendInterval"])
                    continue
                except Exception:
                    pass

            if bot["botUsername"] == "gymeowfly_bot" and GYMEOW_SIGNIN_BUTTON in button_texts and not gymeow_sign_triggered:
                try:
                    await asyncio.wait_for(message.click(GYMEOW_SIGNIN_BUTTON, timeout=1), timeout=2)
                except Exception:
                    # The callback answer may timeout even when the verification card is pushed successfully.
                    pass
                gymeow_sign_triggered = True
                await asyncio.sleep(bot["sendInterval"])
                continue

            key = f"{message.id}"
            if key not in clicked_keys:
                click_result = await click_matching_button(message)
                if click_result["clicked"]:
                    clicked_keys.add(key)
                    answer_result = evaluate_message(click_result["answer"], bot)
                    if answer_result:
                        print(
                            f"[{client.phone_number}] {bot['name']} -> {format_result_label(answer_result)}: {answer_result.get('message', '')}",
                            flush=True
                        )
                        return answer_result
                    await asyncio.sleep(bot["sendInterval"])
                    updated_message = await refetch_message(client, target, message.id)
                    if updated_message:
                        updated_text = updated_message.text or updated_message.caption or ""
                        updated_result = evaluate_message(updated_text, bot)
                        if updated_result:
                            print(
                                f"[{client.phone_number}] {bot['name']} -> {format_result_label(updated_result)}: {updated_result.get('message', '')}",
                                flush=True
                            )
                            return updated_result

            result = evaluate_message(message_text, bot)
            if result:
                print(
                    f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
                    flush=True
                )
                return result
            if result is not None:
                last_result = result

        await asyncio.sleep(2)

    timeout_result = last_result or {"ok": False, "already": False, "skipped": False, "message": "等待 Bot 回复超时"}
    print(f"[{client.phone_number}] {bot['name']} -> 超时", flush=True)
    return timeout_result


async def run_account(account: dict, bots: list[dict], session_map: dict[str, str], skip_cache: dict):
    phone = account["phone"]
    session_string = find_session_string(phone, session_map)
    if not session_string:
        return {
            "phone": phone,
            "ok": False,
            "message": "缺少 Telegram session，请先完成首次登录",
            "bots": []
        }

    applicable_bots = [
        bot for bot in bots
        if not bot.get("targetPhones") or phone in bot.get("targetPhones", [])
    ]
    if not applicable_bots:
        return {
            "phone": phone,
            "ok": True,
            "message": "无适用 Bot",
            "bots": []
        }

    api_id = int(account["apiId"] or API_ID)
    api_hash = account["apiHash"] or API_HASH

    client = Client(
        name=phone,
        api_id=api_id,
        api_hash=api_hash,
        phone_number=phone,
        session_string=session_string,
        in_memory=True,
        workdir=str(CACHE_FILE.parent),
        no_updates=True
    )

    bot_results = []
    try:
        await client.start()
        for bot in applicable_bots:
            if should_skip_bot(skip_cache, phone, bot["botUsername"]):
                reason = skip_cache[phone][bot["botUsername"]]["reason"]
                bot_results.append({
                    "botUsername": bot["botUsername"],
                    "name": bot["name"],
                    "ok": True,
                    "already": False,
                    "skipped": True,
                    "message": reason
                })
                print(f"[{phone}] {bot['name']} -> 跳过: {reason}", flush=True)
                continue
            try:
                result = await run_single_bot(client, bot)
            except Exception as error:
                result = {"ok": False, "already": False, "skipped": False, "message": str(error)}

            if result.get("skipped"):
                set_skip_reason(skip_cache, phone, bot["botUsername"], result.get("message", "跳过"))
            elif result.get("ok"):
                clear_skip_reason(skip_cache, phone, bot["botUsername"])
            bot_results.append({
                "botUsername": bot["botUsername"],
                "name": bot["name"],
                **result
            })
    finally:
        try:
            await client.stop()
        except Exception:
            pass

    return {
        "phone": phone,
        "ok": all(item.get("ok") for item in bot_results) if bot_results else False,
        "message": "执行完成",
        "bots": bot_results
    }


async def main():
    accounts, bots = load_form()
    session_map = load_session_strings()
    skip_cache = load_skip_cache()

    if not accounts:
        print("未配置 Telegram 账号")
        return 1

    if not bots:
        print("未配置 Bot 模板")
        return 1

    enabled_accounts = [item for item in accounts if item["enabled"] and item["checkiner"]]
    if not enabled_accounts:
        print("没有启用的 Telegram 签到账号")
        return 1

    results = await asyncio.gather(*[
        run_account(account, bots, session_map, skip_cache)
        for account in enabled_accounts
    ])
    save_skip_cache(skip_cache)

    lines = ["Telegram Bot 签到结果"]
    failed = False
    for account_result in results:
        lines.append(f"账号: {account_result['phone']}")
        if not account_result["bots"]:
            label = "跳过" if account_result.get("ok") else "失败"
            lines.append(f"  - {label}: {account_result['message']}")
            if not account_result.get("ok"):
                failed = True
            continue
        for bot_result in account_result["bots"]:
            lines.append("  " + format_result_line(account_result["phone"], bot_result["name"], bot_result))
            if not bot_result.get("ok") and not bot_result.get("skipped"):
                failed = True

    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
