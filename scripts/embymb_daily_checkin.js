#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

loadLocalEnv();

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ACCOUNTS_FILE = path.resolve(
  process.env.EMBYMB_ACCOUNTS_FILE || path.join(DATA_DIR, "embymb_accounts.json")
);
const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_BASE_URL = process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";
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
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
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
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
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
  const candidate = raw || DEFAULT_BASE_URL;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function cloneData(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function parseSetCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function buildCookieHeaderFromSetCookie(headers) {
  return parseSetCookieLines(headers)
    .map((line) => line.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return ["already", "checked in", "已签到", "今日已签到", "明天", "重复"].some((marker) =>
    lowered.includes(marker)
  );
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
    payload = { success: false, message: raw.slice(0, 300) };
  }

  return { response, payload };
}

async function login(account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const loginUrl = new URL("/api/v1/auth/login", `${baseUrl}/`);
  const useEmail = String(account.username || "").includes("@");
  const credentials = useEmail
    ? { email: account.username, username: "", password: account.password }
    : { username: account.username, password: account.password };
  const { response, payload } = await jsonRequest(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Origin: baseUrl,
      Referer: `${baseUrl}/login`
    },
    body: JSON.stringify(credentials)
  });

  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.message || `登录失败 HTTP ${response.status}`);
  }

  const cookie = buildCookieHeaderFromSetCookie(response.headers);
  if (!cookie) {
    throw new Error("登录成功但未获得会话 Cookie");
  }

  return { baseUrl, cookie };
}

async function apiRequest(session, method, routePath, payload) {
  const url = new URL(routePath.replace(/^\//, ""), `${session.baseUrl}/`);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: session.cookie,
    Origin: session.baseUrl,
    Referer: `${session.baseUrl}/dashboard`,
    "User-Agent": USER_AGENT
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

async function getSigninStatus(session) {
  return await apiRequest(session, "GET", "/api/v1/signin/me");
}

async function getSigninConfig(session) {
  return await apiRequest(session, "GET", "/api/v1/signin/config");
}

function summarizeStatusPayload(infoPayload, configPayload) {
  if (infoPayload?.success === true) {
    const data = infoPayload?.data || {};
    const config = configPayload?.data || {};
    return {
      ok: true,
      code: 0,
      state: "active",
      message: data.today_signed ? "今日已签到" : "可签到",
      plan: data.currency_name || config.currency_name || "EmbyMB",
      currency: data.currency_name || config.currency_name || "积分",
      points: Number(data.current_points ?? 0),
      currentStreak: Number(data.current_streak ?? 0),
      longestStreak: Number(data.longest_streak ?? 0),
      todaySigned: Boolean(data.today_signed),
      lastSignInDate: data.last_signin_date || "",
      totalPoints: Number(data.total_points ?? 0),
      dailyMin: Number(config.daily_min ?? data.daily_min ?? 0),
      dailyMax: Number(config.daily_max ?? data.daily_max ?? 0),
      bonusTable: Array.isArray(config.bonus_table) ? config.bonus_table : [],
      raw: cloneData({ infoPayload, configPayload })
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: infoPayload?.message || "签到状态获取失败",
    plan: "EmbyMB",
    currency: configPayload?.data?.currency_name || infoPayload?.data?.currency_name || "积分",
    points: null,
    currentStreak: null,
    longestStreak: null,
    todaySigned: false,
    lastSignInDate: "",
    totalPoints: null,
    dailyMin: Number(configPayload?.data?.daily_min ?? 0),
    dailyMax: Number(configPayload?.data?.daily_max ?? 0),
    bonusTable: Array.isArray(configPayload?.data?.bonus_table) ? configPayload.data.bonus_table : [],
    raw: cloneData({ infoPayload, configPayload })
  };
}

function summarizeCheckinPayload(payload, infoPayload) {
  const data = payload?.data || {};
  const message = String(payload?.message || "");
  const currentPoints = Number(data.current_points ?? infoPayload?.data?.current_points ?? 0);
  const dailyPoints = Number(data.daily_points ?? data.bonus_points ?? 0);
  const currency = data.currency_name || infoPayload?.data?.currency_name || "积分";
  const lastSignInDate = data.last_signin_date || infoPayload?.data?.last_signin_date || "";
  const already = Boolean(data.created === false) || infoPayload?.data?.today_signed === true || isAlreadyCheckedInMessage(message);

  if (payload?.success === true) {
    return {
      ok: true,
      already,
      code: 0,
      message: message || (already ? "今天已经签到过了" : "签到成功"),
      points: already ? 0 : dailyPoints,
      balance: currentPoints,
      currency,
      currentPoints,
      lastSignInDate,
      todaySigned: true,
      raw: cloneData(payload)
    };
  }

  if (already) {
    return {
      ok: true,
      already: true,
      code: 0,
      message: message || "今天已经签到过了",
      points: 0,
      balance: currentPoints,
      currency,
      currentPoints,
      lastSignInDate,
      todaySigned: true,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: payload?.code ?? null,
    message: message || "签到失败",
    points: 0,
    balance: currentPoints,
    currency,
    currentPoints,
    lastSignInDate,
    todaySigned: Boolean(infoPayload?.data?.today_signed),
    raw: cloneData(payload)
  };
}

function reconcileCheckinWithStatus(checkin, status) {
  if (checkin?.ok || !status?.todaySigned) {
    return checkin;
  }

  const balance = status.points != null
    ? Number(status.points)
    : checkin?.balance ?? checkin?.currentPoints ?? null;

  return {
    ...checkin,
    ok: true,
    already: true,
    code: checkin?.code ?? 0,
    message: status.message || "状态刷新确认今日已签到",
    points: 0,
    balance,
    currentPoints: balance,
    currency: status.currency || checkin?.currency || "积分",
    lastSignInDate: status.lastSignInDate || checkin?.lastSignInDate || "",
    todaySigned: true,
    reconciledAfterStatusRefresh: true
  };
}

async function refreshAccountStatus(account) {
  const now = formatIso();
  let status;
  try {
    const session = await login(account);
    const infoPayload = await getSigninStatus(session);
    const configPayload = await getSigninConfig(session);
    status = summarizeStatusPayload(infoPayload, configPayload);
  } catch (error) {
    status = {
      ok: false,
      code: null,
      state: "error",
      message: error.message,
      plan: "EmbyMB",
      currency: "积分",
      points: null,
      currentStreak: null,
      longestStreak: null,
      todaySigned: false,
      lastSignInDate: "",
      totalPoints: null,
      dailyMin: null,
      dailyMax: null,
      bonusTable: [],
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
    const infoPayload = await getSigninStatus(session);

    if (infoPayload?.data?.today_signed) {
      return summarizeCheckinPayload({
        success: true,
        message: "今日已签到",
        data: {
          created: false,
          current_points: infoPayload?.data?.current_points,
          daily_points: 0,
          currency_name: infoPayload?.data?.currency_name,
          last_signin_date: infoPayload?.data?.last_signin_date,
          total_points: infoPayload?.data?.total_points
        }
      }, infoPayload);
    }

    const payload = await apiRequest(session, "POST", "/api/v1/signin");
    return summarizeCheckinPayload(payload, infoPayload);
  } catch (error) {
    return {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: 0,
      balance: null,
      currency: "积分",
      currentPoints: null,
      lastSignInDate: "",
      todaySigned: false,
      raw: null
    };
  }
}

function shouldRetryCheckin(checkin, attemptNumber) {
  if (attemptNumber >= CHECKIN_MAX_ATTEMPTS) return false;
  if (checkin.ok) return false;
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
      code: checkin.code,
      message: checkin.message,
      at: formatIso()
    });

    if (!shouldRetryCheckin(checkin, attemptNumber)) {
      break;
    }

    console.warn(
      `[embymb-checkin] retry scheduled for ${account.name} (${attemptNumber}/${CHECKIN_MAX_ATTEMPTS}) after failure: ${checkin.message}`
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
  nextAccount.lastCheckin = reconcileCheckinWithStatus(nextAccount.lastCheckin, nextAccount.lastStatus);
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
  if (!chatId) return;
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
  if (TELEGRAM_CHAT_ID) return TELEGRAM_CHAT_ID;
  const stored = readStoredTelegramChatId();
  if (stored) return stored;
  const updates = await telegramApi("getUpdates");
  const latest = [...updates]
    .reverse()
    .map((item) => item.message || item.edited_message || item.channel_post || item.callback_query?.message || null)
    .find((message) => message?.chat?.id != null);
  const chatId = latest?.chat?.id != null ? String(latest.chat.id) : "";
  if (chatId) storeTelegramChatId(chatId);
  return chatId;
}

function splitTelegramText(text, limit = 3500) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = remaining.lastIndexOf("\n", limit);
    if (index < 0 || index < limit / 2) index = limit;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
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
    throw new Error("无法确定 Telegram chat_id。请先给机器人发送一条消息，或在 .env 中设置 TELEGRAM_CHAT_ID。");
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
  const active = results.filter((item) => item.lastStatus?.state === "active").length;

  const lines = [
    "EmbyMB 每日签到报告",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `账号总数: ${results.length}`,
    `签到成功: ${success}`,
    `今日已签: ${already}`,
    `签到失败: ${failed}`,
    `当前状态正常: ${active}`,
    `失败重试: 最多 ${CHECKIN_MAX_ATTEMPTS} 次，间隔 ${CHECKIN_RETRY_DELAY_MS} ms`,
    ""
  ];

  results.forEach((account, index) => {
    const checkin = account.lastCheckin;
    const status = account.lastStatus;
    const checkinLabel = !checkin
      ? "未执行"
      : checkin.ok
        ? checkin.already
          ? `已签过 | ${checkin.message}`
          : `成功 | ${checkin.message}`
        : `失败 | ${checkin.message}`;
    const statusLabel = status
      ? `${status.state || "unknown"} | ${status.message || ""}`.trim()
      : "未获取状态";

    lines.push(`${index + 1}. ${account.name}`);
    lines.push(`签到: ${checkinLabel}`);
    lines.push(`尝试次数: ${checkin?.attemptCount ?? 0}/${checkin?.maxAttempts ?? CHECKIN_MAX_ATTEMPTS}`);
    lines.push(`状态: ${statusLabel}`);
    lines.push(`积分: ${status?.points ?? checkin?.balance ?? "--"} ${status?.currency || checkin?.currency || "积分"}`);
    lines.push(`最近签到日: ${status?.lastSignInDate || checkin?.lastSignInDate || "--"}`);
    lines.push(`站点: ${account.baseUrl || DEFAULT_BASE_URL}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function buildFailureAlert(results, sentAt) {
  const failedAccounts = results.filter((item) => !item.lastCheckin?.ok);
  if (!failedAccounts.length) return "";

  const lines = [
    "EmbyMB 签到失败告警",
    `北京时间: ${formatBeijing(sentAt)}`,
    `失败账号: ${failedAccounts.length}/${results.length}`,
    `已启用重试: 最多 ${CHECKIN_MAX_ATTEMPTS} 次，间隔 ${CHECKIN_RETRY_DELAY_MS} ms`,
    ""
  ];

  failedAccounts.forEach((account, index) => {
    const checkin = account.lastCheckin;
    const status = account.lastStatus;
    lines.push(`${index + 1}. ${account.name}`);
    lines.push(`最终错误: ${checkin?.message || "未知错误"}`);
    lines.push(`尝试次数: ${checkin?.attemptCount ?? 0}/${checkin?.maxAttempts ?? CHECKIN_MAX_ATTEMPTS}`);
    lines.push(`状态: ${status?.state ?? "unknown"} | ${status?.message || "未获取状态"}`);
    if (Array.isArray(checkin?.attempts) && checkin.attempts.length > 0) {
      const attemptText = checkin.attempts.map((item) => `#${item.attempt}:${item.message}`).join(" | ");
      lines.push(`重试轨迹: ${attemptText}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

async function main() {
  const startedAt = new Date();
  const accounts = readAccounts();

  if (!accounts.length) {
    const report = [
      "EmbyMB 每日签到报告",
      `北京时间: ${formatBeijing(startedAt)}`,
      "没有可签到的账号记录。"
    ].join("\n");

    if (TELEGRAM_BOT_TOKEN) {
      await sendTelegramReport(report);
    }
    console.log(report);
    return;
  }

  const nextAccounts = [];
  for (const account of accounts) {
    nextAccounts.push(await runAccountCheckin(account));
  }

  writeAccounts(nextAccounts);

  const report = buildReport(nextAccounts, startedAt);
  console.log(report);

  if (TELEGRAM_BOT_TOKEN) {
    const chatId = await sendTelegramReport(report);
    console.log(`Telegram 已发送到 chat_id=${chatId}`);

    if (TELEGRAM_ALERT_ON_FAILURE) {
      const failureAlert = buildFailureAlert(nextAccounts, startedAt);
      if (failureAlert) {
        await sendTelegramReport(failureAlert);
        console.log("Telegram 失败告警已发送");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
