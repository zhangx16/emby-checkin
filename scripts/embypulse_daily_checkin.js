#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

loadLocalEnv();

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ACCOUNTS_FILE = path.resolve(
  process.env.EMBYPULSE_ACCOUNTS_FILE || path.join(DATA_DIR, "embypulse_accounts.json")
);
const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const CHECKIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.CHECKIN_MAX_ATTEMPTS || 3));
const CHECKIN_RETRY_DELAY_MS = Math.max(0, Number(process.env.CHECKIN_RETRY_DELAY_MS || 5000));
const TELEGRAM_ALERT_ON_FAILURE = parseBoolean(process.env.TELEGRAM_ALERT_ON_FAILURE, true);
const TELEGRAM_DRY_RUN = parseBoolean(process.env.TELEGRAM_DRY_RUN, false);
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatBeijing(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readAccounts() {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  ensureDataDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("baseUrl 不能为空");
  }
  const candidate = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  return candidate.replace(/\/+$/, "");
}

function cloneData(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function parseSetCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }

  return raw.split(/,(?=[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function buildCookieHeaderFromSetCookie(headers) {
  return parseSetCookieLines(headers)
    .map((line) => line.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function summarizeInfoPayload(payload) {
  if (payload?.status === "success") {
    return {
      ok: true,
      points: Number(payload?.data?.points ?? 0),
      hasCheckedIn: Boolean(payload?.data?.has_checked_in),
      config: cloneData(payload?.data?.config || {}),
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    points: null,
    hasCheckedIn: false,
    config: null,
    raw: cloneData(payload),
    message: String(payload?.message || "积分信息获取失败")
  };
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return ["已签到", "明天再来", "already", "tomorrow"].some((marker) => lowered.includes(marker));
}

function summarizeCheckinPayload(payload) {
  if (payload?.status === "success") {
    return {
      ok: true,
      already: false,
      reward: Number(payload?.reward ?? 0),
      balance: Number(payload?.balance ?? 0),
      message: String(payload?.message || "签到成功"),
      raw: cloneData(payload)
    };
  }

  const message = String(payload?.message || "签到失败");
  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      reward: Number(payload?.reward ?? 0),
      balance: Number(payload?.balance ?? 0),
      message,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    reward: Number(payload?.reward ?? 0),
    balance: Number(payload?.balance ?? 0),
    message,
    raw: cloneData(payload)
  };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...options
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { status: "error", message: raw.slice(0, 300) };
  }

  return { response, payload };
}

async function login(account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const loginUrl = new URL("/api/requests/auth", `${baseUrl}/`);
  const { response, payload } = await jsonRequest(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    },
    body: JSON.stringify({
      username: account.username,
      password: account.password
    })
  });

  if (!response.ok || payload?.status !== "success") {
    throw new Error(payload?.message || `登录失败 HTTP ${response.status}`);
  }

  const cookie = buildCookieHeaderFromSetCookie(response.headers);
  if (!cookie) {
    throw new Error("登录成功但未获得会话 Cookie");
  }

  return {
    baseUrl,
    cookie,
    insecureTls: Boolean(account.insecureTls)
  };
}

async function embypulseApiRequest(session, method, routePath, payload) {
  const url = new URL(routePath.replace(/^\//, ""), `${session.baseUrl}/`);
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
    "Cookie": session.cookie,
    "Origin": session.baseUrl,
    "Referer": `${session.baseUrl}/`
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const { response, payload: data } = await jsonRequest(url, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined
  });

  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }

  return data;
}

async function refreshAccountStatus(account) {
  const now = formatIso();
  let status;

  try {
    const session = await login(account);
    const payload = await embypulseApiRequest(session, "GET", "/api/user/points/info");
    status = summarizeInfoPayload(payload);
  } catch (error) {
    status = {
      ok: false,
      points: null,
      hasCheckedIn: false,
      config: null,
      message: error.message,
      raw: null
    };
  }

  return {
    ...account,
    updatedAt: now,
    lastStatusAt: now,
    lastStatus: status
  };
}

async function attemptCheckin(account) {
  try {
    const session = await login(account);
    const infoPayload = await embypulseApiRequest(session, "GET", "/api/user/points/info");
    const info = summarizeInfoPayload(infoPayload);

    if (info.ok && info.hasCheckedIn) {
      return {
        ok: true,
        already: true,
        reward: 0,
        balance: Number(info.points ?? 0),
        message: "今天已经签到过了，明天再来吧！",
        raw: cloneData(infoPayload)
      };
    }

    const checkinPayload = await embypulseApiRequest(session, "POST", "/api/user/points/checkin");
    const checkin = summarizeCheckinPayload(checkinPayload);

    if (checkin.ok && Number.isFinite(info.points)) {
      checkin.balance = Number.isFinite(checkin.balance) && checkin.balance > 0
        ? checkin.balance
        : Number(info.points) + Number(checkin.reward || 0);
    }

    return checkin;
  } catch (error) {
    return {
      ok: false,
      already: false,
      reward: 0,
      balance: null,
      message: error.message,
      raw: null
    };
  }
}

function shouldRetryCheckin(checkin, attemptNumber) {
  if (attemptNumber >= CHECKIN_MAX_ATTEMPTS) {
    return false;
  }
  if (checkin.ok) {
    return false;
  }
  return true;
}

async function runAccountCheckin(account) {
  const now = formatIso();
  let nextAccount = { ...account };
  let checkin = null;
  const attempts = [];

  for (let attemptNumber = 1; attemptNumber <= CHECKIN_MAX_ATTEMPTS; attemptNumber += 1) {
    checkin = await attemptCheckin(account);
    attempts.push({
      attempt: attemptNumber,
      ok: checkin.ok,
      already: checkin.already,
      reward: checkin.reward,
      balance: checkin.balance,
      message: checkin.message,
      at: formatIso()
    });

    if (!shouldRetryCheckin(checkin, attemptNumber)) {
      break;
    }

    console.warn(
      `[embypulse-checkin] retry scheduled for ${account.name} (${attemptNumber}/${CHECKIN_MAX_ATTEMPTS}) after failure: ${checkin.message}`
    );
    if (CHECKIN_RETRY_DELAY_MS > 0) {
      await sleep(CHECKIN_RETRY_DELAY_MS);
    }
  }

  checkin = {
    ...checkin,
    attemptCount: attempts.length,
    maxAttempts: CHECKIN_MAX_ATTEMPTS,
    retryCount: Math.max(0, attempts.length - 1),
    attempts
  };

  nextAccount.lastCheckinAt = now;
  nextAccount.lastCheckin = checkin;
  nextAccount.updatedAt = now;
  nextAccount = await refreshAccountStatus(nextAccount);

  return nextAccount;
}

function readStoredTelegramChatId() {
  try {
    return fs.readFileSync(TELEGRAM_CHAT_ID_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function storeTelegramChatId(chatId) {
  if (!chatId) {
    return;
  }
  ensureDataDir();
  fs.writeFileSync(TELEGRAM_CHAT_ID_FILE, `${chatId}\n`);
}

async function telegramApi(method, payload = null) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("未配置 TELEGRAM_BOT_TOKEN");
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const options = {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };

  if (payload) {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Telegram 返回异常: ${text.slice(0, 180)}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API 失败: ${data.description || text.slice(0, 180)}`);
  }

  return data.result;
}

async function resolveTelegramChatId() {
  if (TELEGRAM_CHAT_ID) {
    return TELEGRAM_CHAT_ID;
  }

  const stored = readStoredTelegramChatId();
  if (stored) {
    return stored;
  }

  const updates = await telegramApi("getUpdates");
  const latest = [...updates]
    .reverse()
    .map((item) => item.message || item.edited_message || item.channel_post || item.callback_query?.message || null)
    .find((message) => message?.chat?.id != null);

  const chatId = latest?.chat?.id != null ? String(latest.chat.id) : "";
  if (chatId) {
    storeTelegramChatId(chatId);
  }
  return chatId;
}

function splitTelegramText(text, limit = 3500) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = remaining.lastIndexOf("\n", limit);
    if (index < 0 || index < limit / 2) {
      index = limit;
    }
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n+/, "");
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendTelegramReport(text) {
  if (TELEGRAM_DRY_RUN) {
    console.log("[telegram dry run]");
    console.log(text);
    return "dry-run";
  }

  const chatId = await resolveTelegramChatId();
  if (!chatId) {
    throw new Error("无法确定 Telegram chat_id");
  }

  for (const chunk of splitTelegramText(text)) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    });
  }

  return chatId;
}

function buildReport(results, sentAt) {
  const success = results.filter((item) => item.lastCheckin?.ok && !item.lastCheckin?.already).length;
  const already = results.filter((item) => item.lastCheckin?.already).length;
  const failed = results.filter((item) => !item.lastCheckin?.ok).length;

  const lines = [
    "EmbyPulse 每日签到报告",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `账号总数: ${results.length}`,
    `签到成功: ${success}`,
    `今日已签: ${already}`,
    `签到失败: ${failed}`,
    ""
  ];

  for (const account of results) {
    const checkin = account.lastCheckin || {};
    const status = account.lastStatus || {};
    const checkinLabel = checkin.ok
      ? (checkin.already ? `今日已签 · ${checkin.message}` : `签到成功 · +${checkin.reward || 0} 积分`)
      : `签到失败 · ${checkin.message || "未知错误"}`;

    lines.push(`- ${account.name}`);
    lines.push(`  站点: ${account.baseUrl}`);
    lines.push(`  签到: ${checkinLabel}`);
    lines.push(`  当前积分: ${status.points ?? checkin.balance ?? "--"}`);
    lines.push(`  最后更新时间: ${account.updatedAt || "--"}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function main() {
  const accounts = readAccounts();
  if (!accounts.length) {
    console.log("[embypulse-checkin] no accounts configured");
    return;
  }

  if (accounts.some((item) => Boolean(item?.insecureTls))) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const nextAccounts = [];
  for (const account of accounts) {
    nextAccounts.push(await runAccountCheckin(account));
  }
  writeAccounts(nextAccounts);

  const sentAt = new Date();
  const report = buildReport(nextAccounts, sentAt);
  console.log(report);

  try {
    const chatId = await sendTelegramReport(report);
    console.log(`[embypulse-checkin] telegram delivered to ${chatId}`);
  } catch (error) {
    console.error(`[embypulse-checkin] telegram delivery failed: ${error.message}`);
  }

  if (TELEGRAM_ALERT_ON_FAILURE) {
    const failedAccounts = nextAccounts.filter((item) => !item.lastCheckin?.ok);
    if (failedAccounts.length) {
      const alertText = [
        "EmbyPulse 签到失败告警",
        `北京时间: ${formatBeijing(sentAt)}`,
        ...failedAccounts.map((item) => `- ${item.name}: ${item.lastCheckin?.message || "未知错误"}`)
      ].join("\n");
      try {
        await sendTelegramReport(alertText);
      } catch (error) {
        console.error(`[embypulse-checkin] telegram alert failed: ${error.message}`);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`[embypulse-checkin] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
