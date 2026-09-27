#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

loadLocalEnv();

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ACCOUNTS_FILE = path.resolve(
  process.env.ZHOUSANWAN_ACCOUNTS_FILE || path.join(DATA_DIR, "zhousanwan_accounts.json")
);
const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_BASE_URL = process.env.DEFAULT_ZHOUSANWAN_BASE_URL || "https://zhousanwan.xyz";
const CHECKIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.CHECKIN_MAX_ATTEMPTS || 5));
const CHECKIN_RETRY_DELAY_MS = Math.max(0, Number(process.env.CHECKIN_RETRY_DELAY_MS || 8000));
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
  const candidate = raw || DEFAULT_BASE_URL;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function cloneData(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function mergeCookieHeaders(...cookieHeaders) {
  const cookies = new Map();
  for (const header of cookieHeaders) {
    for (const part of String(header || "").split(";")) {
      const item = part.trim();
      if (!item) continue;
      const index = item.indexOf("=");
      if (index <= 0) continue;
      cookies.set(item.slice(0, index), item.slice(index + 1));
    }
  }

  return Array.from(cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function cookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  const found = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!found) {
    return "";
  }

  try {
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return found.slice(prefix.length);
  }
}

function runCommandCapture(command, args, stdin = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });

    if (stdin) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

function splitHttpMessage(httpMessage) {
  const crlfIndex = httpMessage.lastIndexOf("\r\n\r\n");
  const lfIndex = httpMessage.lastIndexOf("\n\n");
  let separatorIndex = -1;
  let separatorLength = 0;

  if (crlfIndex >= 0 && (lfIndex < 0 || crlfIndex >= lfIndex)) {
    separatorIndex = crlfIndex;
    separatorLength = 4;
  } else if (lfIndex >= 0) {
    separatorIndex = lfIndex;
    separatorLength = 2;
  }

  if (separatorIndex < 0) {
    return { headerText: "", body: httpMessage };
  }

  return {
    headerText: httpMessage.slice(0, separatorIndex),
    body: httpMessage.slice(separatorIndex + separatorLength)
  };
}

function extractSetCookies(headerText) {
  return headerText
    .split(/\r?\n/)
    .filter((line) => /^set-cookie:/i.test(line))
    .map((line) => line.replace(/^set-cookie:\s*/i, "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function isTransientZhousanwanError(message) {
  const text = String(message || "").toLowerCase();
  return [
    "http 408",
    "http 425",
    "http 429",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "error code: 502",
    "error code: 503",
    "error code: 504",
    "bad gateway",
    "gateway timeout",
    "service unavailable",
    "cloudflare",
    "timed out",
    "timeout",
    "econnreset",
    "econnrefused",
    "enotfound",
    "socket hang up",
    "tls",
    "ssl",
    "temporarily unavailable",
    "接口返回不是 json",
    "接口返回异常"
  ].some((marker) => text.includes(marker));
}

async function zhousanwanCurlJson(baseUrl, method, routePath, payload, cookie = "") {
  const url = new URL(routePath, `${baseUrl}/`).toString();
  const marker = "__ZHOUSANWAN_HTTP__:";
  const upperMethod = String(method || "GET").toUpperCase();
  const hasBody = payload !== undefined;
  const args = [
    "--http1.1",
    "--retry",
    "3",
    "--retry-delay",
    "2",
    "--retry-all-errors",
    "--max-time",
    String(Math.max(5, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
    "-sS",
    "-i",
    "-X",
    upperMethod,
    url,
    "-H",
    "Accept: application/json",
    "-H",
    "X-Requested-With: next-portal",
    "-H",
    `Origin: ${baseUrl}`,
    "-H",
    `Referer: ${baseUrl}/dashboard`,
    "-H",
    `User-Agent: ${USER_AGENT}`
  ];

  const csrf = cookieValue(cookie, "next_csrf");
  if (cookie) {
    args.push("-H", `Cookie: ${cookie}`);
  }
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && upperMethod !== "OPTIONS" && csrf) {
    args.push("-H", `X-CSRF-Token: ${csrf}`);
  }
  if (hasBody) {
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  }
  args.push("-w", `\n${marker}%{http_code}`);

  const stdin = hasBody ? JSON.stringify(payload) : "";
  const raw = await runCommandCapture("curl", args, stdin);
  const markerIndex = raw.lastIndexOf(`\n${marker}`);
  if (markerIndex === -1) {
    throw new Error(`周三晚接口返回异常: ${raw.slice(0, 180)}`);
  }

  const httpMessage = raw.slice(0, markerIndex);
  const statusCode = Number(raw.slice(markerIndex + marker.length + 1).trim());
  const { headerText, body } = splitHttpMessage(httpMessage);
  const setCookies = extractSetCookies(headerText);
  const bodyText = String(body || "").trim();

  let data = {};
  let parseError = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch (error) {
      parseError = error;
    }
  }

  if (!Number.isFinite(statusCode) || statusCode >= 400) {
    const statusLabel = Number.isFinite(statusCode) ? `HTTP ${statusCode}` : "HTTP 未知";
    const message =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      (bodyText ? bodyText.slice(0, 180) : statusLabel);
    throw new Error(message.includes("HTTP ") ? message : `${statusLabel}: ${message}`);
  }

  if (parseError) {
    throw new Error(`周三晚接口返回不是 JSON: ${bodyText.slice(0, 180)}`);
  }

  return {
    data,
    cookie: mergeCookieHeaders(cookie, setCookies),
    statusCode
  };
}

async function login(account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const deviceId = account.deviceId || `checkin-${crypto.createHash("sha256").update(account.username).digest("hex").slice(0, 16)}`;
  const response = await zhousanwanCurlJson(baseUrl, "POST", "/api/v1/auth/login", {
    account_name: account.username,
    password: account.password,
    device_id: deviceId
  });

  if (!response.data?.ok) {
    throw new Error(response.data?.error?.message || "周三晚登录失败");
  }
  if (!response.cookie) {
    throw new Error("周三晚登录成功但未获得会话 Cookie");
  }

  return {
    baseUrl,
    cookie: response.cookie
  };
}

async function zhousanwanApiRequest(session, method, routePath, payload) {
  const response = await zhousanwanCurlJson(session.baseUrl, method, routePath, payload, session.cookie);
  session.cookie = response.cookie || session.cookie;
  return response.data;
}

function formatMinorAmount(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "--";
  }
  return (amount / 100).toFixed(2);
}

function beijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function ledgerItems(walletPayload) {
  if (Array.isArray(walletPayload?.data?.ledger?.items)) {
    return walletPayload.data.ledger.items;
  }
  if (Array.isArray(walletPayload?.ledger?.items)) {
    return walletPayload.ledger.items;
  }
  return [];
}

function isZhousanwanCheckinEntry(item) {
  return (
    item?.reference_type === "finance.checkin" ||
    item?.reason === "finance.checkin_reward"
  );
}

function latestCheckin(walletPayload) {
  return ledgerItems(walletPayload).find((item) => isZhousanwanCheckinEntry(item)) || null;
}

function findCheckinOnDate(walletPayload, date = beijingDateString()) {
  return (
    ledgerItems(walletPayload).find(
      (item) => isZhousanwanCheckinEntry(item) && String(item?.reference_id || "") === date
    ) || null
  );
}

function summarizeStatusPayload(payload) {
  if (payload?.ok) {
    const wallet = payload?.data?.wallet || {};
    const checkin = latestCheckin(payload);
    const todayCheckin = findCheckinOnDate(payload);
    return {
      ok: true,
      state: "active",
      message: todayCheckin
        ? "今日已签到"
        : checkin
          ? "状态正常，最近有签到记录"
          : "状态正常",
      points: Number(wallet.balance_minor ?? 0),
      balance: formatMinorAmount(wallet.balance_minor),
      currency: wallet.currency || "TOKEN",
      lastCheckinDate: checkin?.reference_id || "",
      todaySigned: Boolean(todayCheckin),
      todayCheckinDate: todayCheckin?.reference_id || "",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    state: "error",
    message: payload?.error?.message || payload?.message || "钱包状态获取失败",
    points: null,
    balance: null,
    currency: "TOKEN",
    todaySigned: false,
    raw: cloneData(payload)
  };
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return [
    "已签到",
    "已经签到",
    "今天已经签到过了",
    "请勿重复签到",
    "重复签到",
    "明天再来",
    "already",
    "idempotent"
  ].some((marker) => lowered.includes(marker));
}

function summarizeCheckinPayload(payload) {
  const message = String(payload?.error?.message || payload?.message || "");
  if (payload?.ok) {
    const data = payload.data || {};
    const entry = data.entry || {};
    const wallet = data.wallet || {};
    const idempotent = Boolean(data.idempotent);
    return {
      ok: true,
      already: idempotent,
      points: Number(entry.amount_minor ?? data.checkin?.reward_minor ?? 0),
      balance: Number(wallet.balance_minor ?? entry.balance_after_minor ?? 0),
      balanceText: formatMinorAmount(wallet.balance_minor ?? entry.balance_after_minor),
      currency: wallet.currency || data.checkin?.currency || "TOKEN",
      checkinDate: data.checkin?.checkin_date || entry.reference_id || "",
      message: idempotent ? "今天已经签到过了" : "签到成功",
      raw: cloneData(payload)
    };
  }

  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      points: 0,
      balance: null,
      message: message || "今天已经签到过了",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    points: 0,
    balance: null,
    message: message || "签到失败",
    raw: cloneData(payload)
  };
}

function summarizeAlreadyCheckedInFromWallet(status) {
  return {
    ok: true,
    already: true,
    points: 0,
    balance: status?.points ?? null,
    balanceText: status?.balance ?? null,
    currency: status?.currency || "TOKEN",
    checkinDate: status?.todayCheckinDate || status?.lastCheckinDate || beijingDateString(),
    message: "今天已经签到过了",
    raw: status?.raw || null,
    fromWallet: true
  };
}

function reconcileCheckinWithStatus(checkin, status) {
  if (checkin?.ok) {
    return checkin;
  }
  if (!status?.todaySigned && !status?.ok) {
    return checkin;
  }
  if (!status?.todaySigned) {
    return checkin;
  }
  return {
    ...summarizeAlreadyCheckedInFromWallet(status),
    reconciledAfterStatusRefresh: true,
    previousMessage: checkin?.message || ""
  };
}

async function refreshAccountStatus(account, session = null) {
  const now = formatIso();
  let status;

  try {
    const activeSession = session || (await login(account));
    const payload = await zhousanwanApiRequest(
      activeSession,
      "GET",
      "/api/v1/finance/wallet/me?limit=35"
    );
    status = summarizeStatusPayload(payload);
  } catch (error) {
    status = {
      ok: false,
      state: "error",
      message: error.message,
      points: null,
      balance: null,
      currency: "TOKEN",
      todaySigned: false,
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
    // Prefer wallet state: site uses Asia/Shanghai calendar days for checkins.
    const walletPayload = await zhousanwanApiRequest(
      session,
      "GET",
      "/api/v1/finance/wallet/me?limit=35"
    );
    const status = summarizeStatusPayload(walletPayload);
    if (status.todaySigned) {
      return summarizeAlreadyCheckedInFromWallet(status);
    }

    // Frontend posts an empty JSON object body.
    const payload = await zhousanwanApiRequest(session, "POST", "/api/v1/finance/checkins", {});
    return summarizeCheckinPayload(payload);
  } catch (error) {
    return {
      ok: false,
      already: false,
      points: 0,
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
  return isTransientZhousanwanError(checkin.message);
}

function retryDelayMs(attemptNumber) {
  const base = CHECKIN_RETRY_DELAY_MS;
  if (base <= 0) {
    return 0;
  }
  // 8s, 16s, 24s... capped at 60s
  return Math.min(60000, base * attemptNumber);
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
      points: checkin.points,
      balance: checkin.balance,
      message: checkin.message,
      at: formatIso()
    });

    if (!shouldRetryCheckin(checkin, attemptNumber)) {
      break;
    }

    const delayMs = retryDelayMs(attemptNumber);
    console.warn(
      `[zhousanwan-checkin] retry scheduled for ${account.name} (${attemptNumber}/${CHECKIN_MAX_ATTEMPTS}) after failure: ${checkin.message}`
    );
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  nextAccount.lastCheckinAt = now;
  nextAccount.lastCheckin = checkin;
  nextAccount.updatedAt = now;
  nextAccount = await refreshAccountStatus(nextAccount);
  checkin = reconcileCheckinWithStatus(checkin, nextAccount.lastStatus);

  checkin = {
    ...checkin,
    attemptCount: attempts.length,
    maxAttempts: CHECKIN_MAX_ATTEMPTS,
    retryCount: Math.max(0, attempts.length - 1),
    attempts
  };
  nextAccount.lastCheckin = checkin;

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
    "周三晚每日签到报告",
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
    const rewardText = `${formatMinorAmount(checkin.points)} ${checkin.currency || status.currency || "TOKEN"}`;
    const balanceText = status.balance ?? checkin.balanceText ?? "--";
    const checkinLabel = checkin.ok
      ? (checkin.already ? `今日已签 · ${checkin.message}` : `签到成功 · +${rewardText}`)
      : `签到失败 · ${checkin.message || "未知错误"}`;

    lines.push(`- ${account.name}`);
    lines.push(`  站点: ${account.baseUrl}`);
    lines.push(`  签到: ${checkinLabel}`);
    lines.push(`  当前余额: ${balanceText} ${status.currency || checkin.currency || "TOKEN"}`);
    lines.push(`  最近签到日: ${status.lastCheckinDate || checkin.checkinDate || "--"}`);
    lines.push(`  最后更新时间: ${account.updatedAt || "--"}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function main() {
  const accounts = readAccounts();
  if (!accounts.length) {
    console.log("[zhousanwan-checkin] no accounts configured");
    return;
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
    console.log(`[zhousanwan-checkin] telegram delivered to ${chatId}`);
  } catch (error) {
    console.error(`[zhousanwan-checkin] telegram delivery failed: ${error.message}`);
  }

  if (TELEGRAM_ALERT_ON_FAILURE) {
    const failedAccounts = nextAccounts.filter((item) => !item.lastCheckin?.ok);
    if (failedAccounts.length) {
      const alertText = [
        "周三晚签到失败告警",
        `北京时间: ${formatBeijing(sentAt)}`,
        ...failedAccounts.map((item) => `- ${item.name}: ${item.lastCheckin?.message || "未知错误"}`)
      ].join("\n");
      try {
        await sendTelegramReport(alertText);
      } catch (error) {
        console.error(`[zhousanwan-checkin] telegram alert failed: ${error.message}`);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`[zhousanwan-checkin] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
