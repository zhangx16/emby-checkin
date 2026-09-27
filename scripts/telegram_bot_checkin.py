#!/usr/bin/env python3

import asyncio
import http.cookiejar
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from pyrogram import raw
from pyrogram.types import Message

from embykeeper.telegram.pyrogram import Client
from embykeeper.telegram.session import API_ID, API_HASH

PROJECT_ROOT = Path(os.environ.get("CHECKIN_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = PROJECT_ROOT / "data"
FORM_FILE = DATA_DIR / "embykeeper" / "form.json"
CACHE_FILE = DATA_DIR / "embykeeper" / "runtime" / "cache.json"
SKIP_CACHE_FILE = DATA_DIR / "telegram_bot_checkin_skip.json"
RESULTS_FILE = DATA_DIR / "telegram_bot_checkin_results.json"
REQUEST_TIMEOUT = 5
MESSAGE_TIME_SLOP = timedelta(seconds=2)
DEFAULT_BUTTON_HINTS = [
    "签到", "簽到", "打卡", "领取", "我不是机器人", "不是机器人", "点击签到", "立即签到"
]
GYMEOW_VERIFY_HINT = "请先验证你不是机器人"
GYMEOW_VERIFY_BUTTON = "✅ 我不是机器人"
GYMEOW_SIGNIN_BUTTON = "🎯 签到"
MAIKEER_SIGNIN_BUTTON = "✅ 每日签到"
FYEMBY_SIGNIN_BUTTON = "🎯 签到"
OICOVO_SIGNIN_BUTTON = "🎯 签到"
MOONKK_SIGNIN_BUTTON = "✅ 签到"
MENU_SIGNIN_BUTTONS = {
    "fyemby_bot": FYEMBY_SIGNIN_BUTTON,
    "oicovo_bot": OICOVO_SIGNIN_BUTTON,
    "shrekpublic_bot": "🎯 签到",
    "tbagemby_bot": "🎯 签到",
    "chapanda3_bot": "🎯 签到",
}
MOONKK_WEBAPP_HOST = "embyguard.com"
ZZMEB_SIGNIN_BUTTON = "🎯 签到"
ZZMEB_MINIAPP_ORIGIN = "https://miniapp.ftp2.eu.org"
GARYSCLUB_BOT = "garysclubsubbot"
GARYSCLUB_GATE_HINTS = ["尚未加入", "验证开通", "我已加入，重新验证"]
HARD_SKIP_HINTS = [
    "无权",
    "请先点击下面加入我们的群组和频道",
    "无法使用本bot",
    "请先加入",
    "请先关注",
    "必须加入",
    "必须关注",
    "使用本机器人需要满足以下条件",
    "只有已配置 Telegram 群组"
]
ACCOUNT_STATUS_HINTS = [
    "未注册",
    "尚未绑定账户",
    "还没有绑定账号",
    "你还没有绑定账号",
    "请先完成绑定或注册",
    "进行绑定",
    "点击绑定账户"
]
SKIP_HINTS = HARD_SKIP_HINTS + ACCOUNT_STATUS_HINTS


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
            "buttonSequence": normalize_string_list(item.get("buttonSequence") or item.get("button_sequence"), []),
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


def save_checkin_results(results: list[dict], merge_existing: bool = False):
    now = datetime.now(timezone.utc).isoformat()
    by_bot = {}
    for account_result in results:
        phone = account_result.get("phone", "")
        for bot_result in account_result.get("bots", []):
            username = str(bot_result.get("botUsername", "")).strip()
            if not username:
                continue
            record = by_bot.setdefault(username, {
                "botUsername": username,
                "name": bot_result.get("name") or username,
                "checkedAt": now,
                "ok": True,
                "status": "success",
                "message": "",
                "accounts": []
            })
            item = {
                "phone": phone,
                "ok": bool(bot_result.get("ok")),
                "already": bool(bot_result.get("already")),
                "skipped": bool(bot_result.get("skipped")),
                "message": str(bot_result.get("message", "")).strip(),
                "checkedAt": now
            }
            record["accounts"].append(item)
            if not item["ok"] and not item["skipped"]:
                record["ok"] = False

    for record in by_bot.values():
        failed = [item for item in record["accounts"] if not item["ok"] and not item["skipped"]]
        skipped = [item for item in record["accounts"] if item["skipped"]]
        if failed:
            record["status"] = "error"
            record["message"] = failed[0]["message"] or "签到失败"
        elif skipped and len(skipped) == len(record["accounts"]):
            record["status"] = "skipped"
            record["message"] = skipped[0]["message"] or "已跳过"
        else:
            record["status"] = "success"
            record["message"] = "签到完成"

    payload = {
        "updatedAt": now,
        "bots": by_bot
    }
    if merge_existing and RESULTS_FILE.exists():
        existing = load_json(RESULTS_FILE, {})
        existing_bots = existing.get("bots") if isinstance(existing, dict) else {}
        if isinstance(existing_bots, dict) and existing_bots:
            merged = dict(existing_bots)
            merged.update(by_bot)
            payload["bots"] = merged

    RESULTS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def is_account_status_reason(reason: str) -> bool:
    content = str(reason or "")
    if not content:
        return False
    if any(hint in content for hint in HARD_SKIP_HINTS):
        return False
    return any(hint in content for hint in ACCOUNT_STATUS_HINTS)


def prune_account_status_skip_cache(skip_cache: dict) -> dict:
    for phone in list(skip_cache):
        bots = skip_cache.get(phone)
        if not isinstance(bots, dict):
            skip_cache.pop(phone, None)
            continue
        for bot_username in list(bots):
            entry = bots.get(bot_username)
            reason = entry.get("reason") if isinstance(entry, dict) else str(entry or "")
            if is_account_status_reason(reason):
                bots.pop(bot_username, None)
        if not bots:
            skip_cache.pop(phone, None)
    return skip_cache


def should_skip_bot(skip_cache: dict, phone: str, bot_username: str):
    entry = skip_cache.get(phone, {}).get(bot_username)
    if not entry:
        return False
    reason = entry.get("reason") if isinstance(entry, dict) else str(entry or "")
    if is_account_status_reason(reason):
        return False
    return True


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


async def click_button_by_hints(message: Message, hints: list[str]):
    if not message.reply_markup:
        return {"clicked": False, "answer": "", "buttonText": ""}

    keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
    for row in keyboard:
        for button in row:
            text = str(getattr(button, "text", "")).strip()
            if not text:
                continue
            if any(hint in text for hint in hints):
                try:
                    result = await asyncio.wait_for(message.click(text, timeout=5), timeout=8)
                    answer = str(getattr(result, "message", "") or "").strip()
                    return {"clicked": True, "answer": answer, "buttonText": text}
                except Exception:
                    return {"clicked": False, "answer": "", "buttonText": text}
    return {"clicked": False, "answer": "", "buttonText": ""}


async def refetch_message(client: Client, chat_id, message_id: int):
    try:
        messages = await client.get_messages(chat_id, message_id)
    except Exception:
        return None

    if isinstance(messages, list):
        return messages[0] if messages else None
    return messages


async def run_button_sequence_step(client: Client, target, bot: dict, message: Message, hint: str):
    click_result = await click_button_by_hints(message, [hint])
    if not click_result["clicked"]:
        return {"clicked": False, "result": None, "updated_message": None}

    answer_result = evaluate_message(click_result["answer"], bot)
    if answer_result:
        return {"clicked": True, "result": answer_result, "updated_message": None}

    await asyncio.sleep(bot["sendInterval"])
    updated_message = await refetch_message(client, target, message.id)
    if updated_message:
        updated_result = evaluate_incoming_message(updated_message, bot)
        if updated_result:
            return {"clicked": True, "result": updated_result, "updated_message": updated_message}
    return {"clicked": True, "result": None, "updated_message": updated_message}


def iter_inline_buttons(message: Message):
    keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
    for row in keyboard:
        for button in row:
            yield button


def message_has_checkin_button(message: Message | None) -> bool:
    if not message:
        return False
    for button in iter_inline_buttons(message):
        text = str(getattr(button, "text", "") or "").strip()
        if text and any(hint in text for hint in DEFAULT_BUTTON_HINTS):
            return True
        web_app = getattr(button, "web_app", None)
        url = str(getattr(web_app, "url", "") or "") if web_app else ""
        if url and ("checkin" in url.lower() or "签到" in text):
            return True
    return False


def evaluate_message(text: str, bot: dict, has_checkin_button: bool = False):
    content = str(text or "").strip()
    lowered = content.lower()
    if not content:
        return None

    if any(keyword in content for keyword in bot["textIgnore"]):
        return None

    if has_checkin_button:
        if any(keyword.lower() in lowered for keyword in bot["checkedKeywords"]):
            return {"ok": True, "already": True, "skipped": False, "message": content}
        if any(keyword.lower() in lowered for keyword in bot["successKeywords"]):
            return {"ok": True, "already": False, "skipped": False, "message": content}
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


def evaluate_incoming_message(message: Message, bot: dict):
    return evaluate_message(
        message.text or message.caption or "",
        bot,
        has_checkin_button=message_has_checkin_button(message),
    )


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
            result = evaluate_incoming_message(message, bot)
            if result:
                return result
        await asyncio.sleep(1)

    return {"ok": False, "already": False, "skipped": False, "message": "等待 Bot 回复超时"}


async def run_maikeer_checkin(client: Client, bot: dict):
    target = bot["botUsername"]
    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP

    await client.send_message(target, "/start")
    await asyncio.sleep(bot["sendInterval"])

    for _ in range(5):
        async for message in client.get_chat_history(target, limit=8):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue

            result = evaluate_incoming_message(message, bot)
            if result:
                return result

            keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
            button_texts = [str(button.text or "").strip() for row in keyboard for button in row]
            if MAIKEER_SIGNIN_BUTTON not in button_texts:
                continue

            try:
                await asyncio.wait_for(message.click(MAIKEER_SIGNIN_BUTTON, timeout=5), timeout=8)
                return {
                    "ok": True,
                    "already": False,
                    "skipped": False,
                    "message": "每日签到按钮已点击"
                }
            except Exception as error:
                return {
                    "ok": False,
                    "already": False,
                    "skipped": False,
                    "message": f"点击每日签到按钮失败: {error}"
                }
        await asyncio.sleep(1)

    return {"ok": False, "already": False, "skipped": False, "message": "未找到每日签到按钮"}


async def run_menu_signin_checkin(client: Client, bot: dict, signin_button: str):
    target = bot["botUsername"]
    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP

    await client.send_message(target, "/start")
    await asyncio.sleep(bot["sendInterval"])

    for _ in range(8):
        async for message in client.get_chat_history(target, limit=8):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue

            message_text = message.text or message.caption or ""
            result = evaluate_incoming_message(message, bot)
            if result:
                return result

            keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
            button_texts = [str(button.text or "").strip() for row in keyboard for button in row]
            if signin_button not in button_texts:
                continue

            try:
                click_result = await asyncio.wait_for(
                    message.click(signin_button, timeout=5),
                    timeout=8
                )
                answer = str(getattr(click_result, "message", "") or "").strip()
                evaluated = evaluate_message(answer, bot)
                if evaluated:
                    return evaluated
            except Exception:
                pass

            for _ in range(8):
                async for followup in client.get_chat_history(target, limit=10):
                    if followup.outgoing:
                        continue
                    if followup.date and followup.date.replace(tzinfo=timezone.utc) < start_time:
                        continue
                    followup_result = evaluate_incoming_message(followup, bot)
                    if followup_result:
                        return followup_result
                await asyncio.sleep(1)

            return {
                "ok": True,
                "already": False,
                "skipped": False,
                "message": "签到按钮已点击"
            }
        await asyncio.sleep(1)

    return {"ok": False, "already": False, "skipped": False, "message": "未找到签到按钮"}


def extract_webapp_init_data(url: str) -> str:
    fragment = parse_qs(urlparse(url).fragment)
    return str((fragment.get("tgWebAppData") or [""])[0] or "")


def as_input_user(peer):
    if isinstance(peer, raw.types.InputUser):
        return peer
    return raw.types.InputUser(user_id=peer.user_id, access_hash=peer.access_hash)


def moonkk_checkin_api_url(webapp_url: str) -> tuple[str, str]:
    parsed = urlparse(webapp_url)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else f"https://{MOONKK_WEBAPP_HOST}"
    server_id = (parse_qs(parsed.query).get("server") or ["server-1"])[0] or "server-1"
    api_url = f"{origin}/api/v1/servers/{server_id}/telegram/checkin"
    return origin, api_url


def post_moonkk_checkin(webapp_url: str, init_data: str) -> dict:
    origin, api_url = moonkk_checkin_api_url(webapp_url)
    body = json.dumps({"init_data": init_data}).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": origin,
            "Referer": webapp_url,
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
            return payload if isinstance(payload, dict) else {"data": payload}
    except urllib.error.HTTPError as error:
        raw_body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_body or "{}")
        except Exception:
            payload = {}
        message = (
            payload.get("error", {}).get("message")
            if isinstance(payload.get("error"), dict)
            else payload.get("message")
        )
        raise RuntimeError(str(message or raw_body or f"HTTP {error.code}").strip() or f"HTTP {error.code}") from error


def evaluate_moonkk_api_payload(payload: dict):
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    status = str(data.get("status") or "").strip()
    wallet = data.get("wallet_balance")
    reward = data.get("reward")
    wallet_text = f"当前余额 {wallet}" if wallet is not None else ""
    if status == "checked_in":
        reward_text = f"获得奖励 {reward}" if reward is not None else "签到成功"
        message = "，".join(item for item in [reward_text, wallet_text] if item) or "签到成功"
        return {"ok": True, "already": False, "skipped": False, "message": message}
    if status == "already_checked_in":
        message = "今日已经签到" + (f"，{wallet_text}" if wallet_text else "")
        return {"ok": True, "already": True, "skipped": False, "message": message}
    if status == "pending":
        return {"ok": True, "already": False, "skipped": False, "message": "签到结果待核对，请勿重复签到"}
    if data.get("site_key") or data.get("challenge"):
        return {
            "ok": False,
            "already": False,
            "skipped": False,
            "message": "签到小程序需要人机验证，当前无法自动完成",
        }
    return None


def find_moonkk_webapp_url(message: Message) -> str:
    keyboard = getattr(message.reply_markup, "inline_keyboard", None) or []
    for row in keyboard:
        for button in row:
            label = str(getattr(button, "text", "") or "").strip()
            web_app = getattr(button, "web_app", None)
            url = str(getattr(web_app, "url", "") or "").strip() if web_app else ""
            if not url:
                continue
            if "mode=checkin" in url or "checkin" in url.lower() or "签到" in label or label == MOONKK_SIGNIN_BUTTON:
                return url
    return ""


async def run_moonkk_checkin(client: Client, bot: dict):
    target = bot["botUsername"]
    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP

    await client.send_message(target, "/start")
    await asyncio.sleep(bot["sendInterval"])

    webapp_url = ""
    for _ in range(8):
        async for message in client.get_chat_history(target, limit=8):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue
            result = evaluate_incoming_message(message, bot)
            if result:
                return result
            webapp_url = find_moonkk_webapp_url(message)
            if webapp_url:
                break
        if webapp_url:
            break
        await asyncio.sleep(1)

    if not webapp_url:
        return {"ok": False, "already": False, "skipped": False, "message": "未找到签到小程序按钮"}

    peer = await client.resolve_peer(target)
    webview = await client.invoke(
        raw.functions.messages.RequestWebView(
            peer=peer,
            bot=peer,
            platform="android",
            url=webapp_url,
        )
    )
    init_data = extract_webapp_init_data(getattr(webview, "url", "") or "")
    if not init_data:
        return {"ok": False, "already": False, "skipped": False, "message": "未能打开签到小程序"}

    payload = await asyncio.to_thread(post_moonkk_checkin, webapp_url, init_data)
    evaluated = evaluate_moonkk_api_payload(payload)
    if evaluated:
        return evaluated
    return {
        "ok": False,
        "already": False,
        "skipped": False,
        "message": f"签到小程序返回无法识别的结果: {json.dumps(payload, ensure_ascii=False)[:200]}",
    }


def zzmeb_miniapp_request(opener, path: str, body=None) -> dict:
    data = None
    headers = {
        "Accept": "application/json",
        "Origin": ZZMEB_MINIAPP_ORIGIN,
        "Referer": f"{ZZMEB_MINIAPP_ORIGIN}/",
        "User-Agent": (
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        ),
    }
    method = "GET"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(
        f"{ZZMEB_MINIAPP_ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with opener.open(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
            return payload if isinstance(payload, dict) else {"data": payload}
    except urllib.error.HTTPError as error:
        raw_body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_body or "{}")
        except Exception:
            payload = {}
        if isinstance(payload, dict) and payload:
            return payload
        raise RuntimeError(str(raw_body or f"HTTP {error.code}").strip() or f"HTTP {error.code}") from error


def post_zzmeb_miniapp_checkin(init_data: str) -> dict:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    auth = zzmeb_miniapp_request(opener, "/api/auth/telegram", {"initData": init_data})
    if auth.get("ok") is False:
        raise RuntimeError(str(auth.get("message") or "MiniApp 登录失败").strip())
    return zzmeb_miniapp_request(opener, "/api/user/checkin", {})


def evaluate_zzmeb_miniapp_payload(payload: dict):
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    message = str(payload.get("message") or "").strip()
    if payload.get("ok") is False:
        return {
            "ok": False,
            "already": False,
            "skipped": False,
            "message": message or "MiniApp 签到失败",
        }
    awarded = data.get("awardedNow")
    score = data.get("newScore")
    reward = data.get("reward")
    if awarded is True:
        parts = [message or "签到成功"]
        if reward is not None and f"+{reward}" not in parts[0]:
            parts.append(f"+{reward} 积分")
        if score is not None:
            parts.append(f"当前积分 {score}")
        return {"ok": True, "already": False, "skipped": False, "message": "，".join(parts)}
    already_text = message or "今天已经签到过了"
    if score is not None and "余额" not in already_text and "积分" not in already_text:
        already_text = f"{already_text}，当前积分 {score}"
    return {"ok": True, "already": True, "skipped": False, "message": already_text}


def merge_dual_checkin(button_result: dict, miniapp_result: dict):
    parts = [
        f"按钮：{button_result.get('message') or ''}".strip("："),
        f"小程序：{miniapp_result.get('message') or ''}".strip("："),
    ]
    results = [button_result, miniapp_result]
    failed = [item for item in results if not item.get("ok") and not item.get("skipped")]
    awarded = [
        item for item in results
        if item.get("ok") and not item.get("already") and not item.get("skipped")
    ]
    already = [item for item in results if item.get("already")]
    skipped = [item for item in results if item.get("skipped")]
    if awarded:
        status = {"ok": True, "already": False, "skipped": False}
    elif failed and not already:
        status = {"ok": False, "already": False, "skipped": False}
    elif already and not failed:
        status = {"ok": True, "already": True, "skipped": False}
    elif skipped and len(skipped) == len(results):
        status = {"ok": True, "already": False, "skipped": True}
    elif failed:
        status = {"ok": False, "already": False, "skipped": False}
    else:
        status = {"ok": True, "already": False, "skipped": False}
    status["message"] = "；".join(parts)
    return status


async def run_zzmeb_miniapp_checkin(client: Client, bot: dict):
    target = bot["botUsername"]
    peer = await client.resolve_peer(target)
    webview = await client.invoke(
        raw.functions.messages.RequestMainWebView(
            peer=peer,
            bot=as_input_user(peer),
            platform="android",
        )
    )
    init_data = extract_webapp_init_data(getattr(webview, "url", "") or "")
    if not init_data:
        return {"ok": False, "already": False, "skipped": False, "message": "未能打开 MiniApp 面板"}
    payload = await asyncio.to_thread(post_zzmeb_miniapp_checkin, init_data)
    evaluated = evaluate_zzmeb_miniapp_payload(payload)
    if evaluated:
        return evaluated
    return {
        "ok": False,
        "already": False,
        "skipped": False,
        "message": f"MiniApp 返回无法识别的结果: {json.dumps(payload, ensure_ascii=False)[:200]}",
    }


async def run_zzmeb_checkin(client: Client, bot: dict):
    button_result = await run_menu_signin_checkin(client, bot, ZZMEB_SIGNIN_BUTTON)
    try:
        miniapp_result = await run_zzmeb_miniapp_checkin(client, bot)
    except Exception as error:
        miniapp_result = {
            "ok": False,
            "already": False,
            "skipped": False,
            "message": str(error) or "MiniApp 签到失败",
        }
    return merge_dual_checkin(button_result, miniapp_result)


async def run_garysclub_checkin(client: Client, bot: dict):
    target = bot["botUsername"]
    start_time = datetime.now(timezone.utc) - MESSAGE_TIME_SLOP

    await client.send_message(target, "/checkin")
    await asyncio.sleep(bot["sendInterval"])

    for _ in range(8):
        async for message in client.get_chat_history(target, limit=10):
            if message.outgoing:
                continue
            if message.date and message.date.replace(tzinfo=timezone.utc) < start_time:
                continue
            message_text = message.text or message.caption or ""
            if any(hint in message_text for hint in GARYSCLUB_GATE_HINTS):
                continue
            result = evaluate_message(message_text, bot, has_checkin_button=False)
            if result and result.get("skipped"):
                continue
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

    if target == "maikeer_bot":
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_maikeer_checkin(client, bot)
        print(
            f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
            flush=True
        )
        return result

    if target.lower() == "moonkkbot":
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_moonkk_checkin(client, bot)
        print(
            f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
            flush=True
        )
        return result

    if target.lower() == "zzmeb_bot":
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_zzmeb_checkin(client, bot)
        print(
            f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
            flush=True
        )
        return result

    if target.lower() == GARYSCLUB_BOT:
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_garysclub_checkin(client, bot)
        print(
            f"[{client.phone_number}] {bot['name']} -> {format_result_label(result)}: {result.get('message', '')}",
            flush=True
        )
        return result

    menu_signin_button = MENU_SIGNIN_BUTTONS.get(target.lower())
    if menu_signin_button:
        print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)
        result = await run_menu_signin_checkin(client, bot, menu_signin_button)
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
    button_sequence = bot.get("buttonSequence") or []
    button_sequence_index = 0
    sent_command_ids = set()

    print(f"[{client.phone_number}] 开始签到 {bot['name']} (@{bot['botUsername']})", flush=True)

    for command in bot["commands"]:
        if command:
            sent = await client.send_message(target, command)
            sent_command_ids.add(sent.id)
            await asyncio.sleep(bot["sendInterval"])

    if not bot["waitResponse"]:
        return {"ok": True, "already": False, "skipped": False, "message": "签到命令已发送"}

    # Foam sends its check-in result separately after the menu callback.
    bot_timeout = {
        "gymeowfly_bot": 12,
        "lilisiebot": 20,
        "wenjian_emby_bot": 20,
        "hsuys_bot": 20,
        "libhsulife": 20,
        "fyemby_bot": 20,
        "oicovo_bot": 20,
        "moonkkbot": 20,
        "miraiembytest_bot": 20,
        "shrekpublic_bot": 20,
        "tbagemby_bot": 20,
        "garysclubsubbot": 20,
        "chapanda3_bot": 20,
    }.get(target.lower(), REQUEST_TIMEOUT)
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
            if bot["isChat"] and (
                message.reply_to_message_id not in sent_command_ids
                or not message.from_user
                or not message.from_user.is_bot
            ):
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

            if button_sequence_index < len(button_sequence):
                current_hint = button_sequence[button_sequence_index]
                key = f"{message.id}:sequence:{button_sequence_index}"
                if key not in clicked_keys:
                    sequence_step = await run_button_sequence_step(client, target, bot, message, current_hint)
                    if sequence_step["clicked"]:
                        clicked_keys.add(key)
                        button_sequence_index += 1
                        if sequence_step["result"]:
                            print(
                                f"[{client.phone_number}] {bot['name']} -> {format_result_label(sequence_step['result'])}: {sequence_step['result'].get('message', '')}",
                                flush=True
                            )
                            return sequence_step["result"]

                        updated_message = sequence_step["updated_message"]
                        if updated_message and button_sequence_index < len(button_sequence):
                            next_hint = button_sequence[button_sequence_index]
                            next_key = f"{updated_message.id}:sequence:{button_sequence_index}"
                            if next_key not in clicked_keys:
                                next_step = await run_button_sequence_step(client, target, bot, updated_message, next_hint)
                                if next_step["clicked"]:
                                    clicked_keys.add(next_key)
                                    button_sequence_index += 1
                                    if next_step["result"]:
                                        print(
                                            f"[{client.phone_number}] {bot['name']} -> {format_result_label(next_step['result'])}: {next_step['result'].get('message', '')}",
                                            flush=True
                                        )
                                        return next_step["result"]
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
                        updated_result = evaluate_incoming_message(updated_message, bot)
                        if updated_result:
                            print(
                                f"[{client.phone_number}] {bot['name']} -> {format_result_label(updated_result)}: {updated_result.get('message', '')}",
                                flush=True
                            )
                            return updated_result

            result = evaluate_incoming_message(message, bot)
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
                reason = result.get("message", "跳过")
                if is_account_status_reason(reason):
                    clear_skip_reason(skip_cache, phone, bot["botUsername"])
                else:
                    set_skip_reason(skip_cache, phone, bot["botUsername"], reason)
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
    selected_bots = {name.strip().lstrip("@").lower() for name in os.environ.get("CHECKIN_BOT_USERNAMES", "").split(",") if name.strip()}
    if selected_bots:
        bots = [bot for bot in bots if bot["botUsername"].lower() in selected_bots]
    session_map = load_session_strings()
    skip_cache = prune_account_status_skip_cache(load_skip_cache())

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
    save_checkin_results(results, merge_existing=bool(selected_bots))

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
