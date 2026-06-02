#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

loadLocalEnv();

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ACCOUNTS_FILE = path.resolve(process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json"));
const INCUDAL_ACCOUNTS_FILE = path.resolve(process.env.INCUDAL_ACCOUNTS_FILE || path.join(DATA_DIR, "incudal_accounts.json"));
const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_BASE_URL = "https://glados.network";
const DEFAULT_INCUDAL_BASE_URL = "https://incudal.com";
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const CHECKIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.CHECKIN_MAX_ATTEMPTS || 3));
const CHECKIN_RETRY_DELAY_MS = Math.max(0, Number(process.env.CHECKIN_RETRY_DELAY_MS || 5000));
const TELEGRAM_ALERT_ON_FAILURE = parseBoolean(process.env.TELEGRAM_ALERT_ON_FAILURE, true);
const TELEGRAM_DRY_RUN = parseBoolean(process.env.TELEGRAM_DRY_RUN, false);
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const INCUDAL_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

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
  } catch (error) {
    return [];
  }
}

function readIncudalAccounts() {
  ensureDataDir();
  if (!fs.existsSync(INCUDAL_ACCOUNTS_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(INCUDAL_ACCOUNTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeAccounts(accounts) {
  ensureDataDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function writeIncudalAccounts(accounts) {
  ensureDataDir();
  fs.writeFileSync(INCUDAL_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  const candidate = raw || DEFAULT_BASE_URL;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function normalizeIncudalBaseUrl(value) {
  const raw = String(value || "").trim();
  const candidate = raw || DEFAULT_INCUDAL_BASE_URL;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function cloneData(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
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
  });
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return ["tomorrow", "already", "checked in", "已签到", "明天", "重复"].some((marker) =>
    lowered.includes(marker)
  );
}

async function gladosApiRequest(account, method, routePath, payload) {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const host = new URL(baseUrl).hostname;
  const url = new URL(`/api/${routePath.replace(/^\/+/, "")}`, `${baseUrl}/`);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: account.cookie,
    Origin: baseUrl,
    Referer: `${baseUrl}/console/checkin`,
    "User-Agent": USER_AGENT
  };

  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    options.body = JSON.stringify(payload ?? { token: host });
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`请求失败: ${error.message}`);
  }

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`接口返回不是 JSON: ${raw.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data.message || raw.slice(0, 180)}`);
  }

  return data;
}

function incudalRequestHeaders(account, token, refererPath = "/entertainment") {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Cookie: account.cookie,
    Origin: normalizeIncudalBaseUrl(account.baseUrl),
    Referer: new URL(refererPath, `${normalizeIncudalBaseUrl(account.baseUrl)}/`).toString(),
    "Sec-CH-UA": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
    "Sec-CH-UA-Mobile": "?1",
    "Sec-CH-UA-Platform": "\"Android\"",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": INCUDAL_USER_AGENT
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function incudalApiRequest(account, token, method, routePath, payload, refererPath = "/entertainment") {
  const baseUrl = normalizeIncudalBaseUrl(account.baseUrl);
  const url = new URL(routePath.replace(/^\//, ""), `${baseUrl}/api/`).toString();
  const marker = "__INCUDAL_HTTP__:";
  const headers = {
    ...incudalRequestHeaders(account, token, refererPath),
    ...(payload !== undefined ? { "Content-Type": "application/json" } : {})
  };
  const args = [
    "--max-time",
    String(Math.max(5, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
    "-sS",
    "-X",
    method,
    url
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    args.push("-H", `${key}: ${value}`);
  }

  if (payload !== undefined) {
    args.push("--data", JSON.stringify(payload));
  }

  args.push("-w", `\n${marker}%{http_code}`);

  const raw = await runCommandCapture("curl", args);
  const markerIndex = raw.lastIndexOf(`\n${marker}`);
  if (markerIndex === -1) {
    throw new Error(`Incudal 接口返回异常: ${raw.slice(0, 180)}`);
  }

  const body = raw.slice(0, markerIndex);
  const statusCode = Number(raw.slice(markerIndex + marker.length + 1).trim());
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    if (/Cloudflare|Attention Required|blocked|cf-wrapper/i.test(body)) {
      throw new Error("Incudal 会话或 Cloudflare 验证已失效，请手动更新 refreshToken / cf_clearance");
    }
    throw new Error(`Incudal 接口返回异常: ${body.slice(0, 180)}`);
  }

  if (!Number.isFinite(statusCode) || statusCode >= 400) {
    throw new Error(data?.error || data?.message || data?.code || `HTTP ${statusCode}`);
  }

  return data;
}

async function incudalRefreshToken(account) {
  const data = await incudalApiRequest(account, "", "POST", "/auth/refresh", {}, "/dashboard");
  if (!data?.token) {
    throw new Error("Incudal refresh 成功但未返回 token");
  }
  return data.token;
}

function summarizeIncudalStatus(checkinStatus, mePayload, poolPayload) {
  const user = mePayload?.user || {};
  const quota = user?.quota || {};
  const pool = poolPayload || {};
  return {
    ok: true,
    code: 0,
    state: checkinStatus?.hasCheckedIn ? "active" : "pending",
    message: checkinStatus?.hasCheckedIn ? "今日已签到" : "可签到",
    leftDays: null,
    vip: null,
    level: null,
    plan: "Incudal Entertainment",
    points: Number(pool?.cpu ?? 0) + Number(pool?.memory ?? 0) + Number(pool?.disk ?? 0) + Number(pool?.traffic ?? 0),
    quota: {
      hostLimit: Number(quota?.hostLimit ?? 0),
      hostUsed: Number(quota?.hostUsed ?? 0),
      friendLimit: Number(quota?.friendLimit ?? 0),
      friendUsed: Number(quota?.friendUsed ?? 0),
      packageLimit: Number(quota?.packageLimit ?? 0),
      packageUsed: Number(quota?.packageUsed ?? 0)
    },
    pool: {
      cpu: Number(pool?.cpu ?? 0),
      memory: Number(pool?.memory ?? 0),
      disk: Number(pool?.disk ?? 0),
      traffic: Number(pool?.traffic ?? 0)
    },
    raw: cloneData({ checkinStatus, mePayload, poolPayload })
  };
}

function summarizeIncudalCheckinPayload(payload, statusPayload, poolPayload) {
  const message = String(payload?.error || payload?.message || payload?.code || "");
  if (payload && !payload.error) {
    return {
      ok: true,
      already: false,
      code: 0,
      message: "签到成功",
      points: Number(payload?.bonusPoints ?? 0),
      reward: {
        type: payload?.codeType || "",
        value: payload?.codeValue ?? null,
        bonusPoints: Number(payload?.bonusPoints ?? 0)
      },
      balance: poolPayload || null,
      raw: cloneData(payload)
    };
  }

  if ((statusPayload?.hasCheckedIn === true) || String(payload?.code || "") === "CHECKIN_ALREADY_TODAY" || isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      code: 0,
      message: message || "今天已经签到过了",
      points: 0,
      balance: poolPayload || null,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: payload?.code || null,
    message: message || "签到失败",
    points: 0,
    balance: poolPayload || null,
    raw: cloneData(payload)
  };
}

function summarizeStatusPayload(payload) {
  const code = Number(payload?.code ?? -999);
  if (code === 0) {
    const data = payload?.data || {};
    return {
      ok: true,
      code,
      state: "active",
      message: payload?.message || "状态正常",
      leftDays: data.leftDays ?? null,
      vip: data.vip ?? null,
      level: data.level ?? null,
      plan: data.plan ?? null,
      raw: cloneData(payload)
    };
  }

  if (code === -100) {
    return {
      ok: false,
      code,
      state: "unpaid",
      message: payload?.message || "待激活或未付费",
      raw: cloneData(payload)
    };
  }

  if (code === -101) {
    return {
      ok: false,
      code,
      state: "expired",
      message: payload?.message || "套餐已过期",
      raw: cloneData(payload)
    };
  }

  if (code === -2) {
    return {
      ok: false,
      code,
      state: "unauthorized",
      message: payload?.message || "Cookie 失效或无权限",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    code,
    state: "error",
    message: payload?.message || "状态获取失败",
    raw: cloneData(payload)
  };
}

function summarizeCheckinPayload(payload) {
  const code = Number(payload?.code ?? -999);
  const message = String(payload?.message || "");

  if (code === 0) {
    return {
      ok: true,
      already: false,
      code,
      message: message || "签到成功",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      code,
      message: message || "今天可能已经签过了",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  if (code === -2) {
    return {
      ok: false,
      already: false,
      code,
      message: "Cookie 失效或无权限",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code,
    message: message || "签到失败",
    points: payload?.points ?? null,
    raw: cloneData(payload)
  };
}

async function refreshAccountStatus(account) {
  const now = formatIso();
  let status;

  try {
    const payload = await gladosApiRequest(account, "GET", "user/status");
    status = summarizeStatusPayload(payload);
  } catch (error) {
    status = {
      ok: false,
      code: null,
      state: "error",
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
    const host = new URL(normalizeBaseUrl(account.baseUrl)).hostname;
    const payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host });
    return summarizeCheckinPayload(payload);
  } catch (error) {
    return {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: null,
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

  if (checkin.code === -2) {
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
      code: checkin.code,
      message: checkin.message,
      at: formatIso()
    });

    if (!shouldRetryCheckin(checkin, attemptNumber)) {
      break;
    }

    console.warn(
      `[glados-checkin] retry scheduled for ${account.name} (${attemptNumber}/${CHECKIN_MAX_ATTEMPTS}) after failure: ${checkin.message}`
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

  if (checkin.ok) {
    nextAccount = await refreshAccountStatus(nextAccount);
  } else if (checkin.code === -2) {
    nextAccount.lastStatusAt = now;
    nextAccount.lastStatus = {
      ok: false,
      code: -2,
      state: "unauthorized",
      message: "Cookie 失效或无权限",
      raw: null
    };
  } else {
    nextAccount = await refreshAccountStatus(nextAccount);
  }

  return nextAccount;
}

async function refreshIncudalAccountStatus(account) {
  const now = formatIso();
  let status;

  try {
    const token = await incudalRefreshToken(account);
    const [checkinStatus, mePayload, poolPayload] = await Promise.all([
      incudalApiRequest(account, token, "GET", "/checkin/status", undefined, "/entertainment"),
      incudalApiRequest(account, token, "GET", "/auth/me", undefined, "/dashboard"),
      incudalApiRequest(account, token, "GET", "/resource-pool", undefined, "/entertainment")
    ]);
    status = summarizeIncudalStatus(checkinStatus, mePayload, poolPayload);
  } catch (error) {
    status = {
      ok: false,
      code: null,
      state: "error",
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

async function runIncudalAccountCheckin(account) {
  const now = formatIso();
  let nextAccount = { ...account };
  let checkin;

  try {
    const token = await incudalRefreshToken(account);
    const statusPayload = await incudalApiRequest(account, token, "GET", "/checkin/status", undefined, "/entertainment");
    const poolPayload = await incudalApiRequest(account, token, "GET", "/resource-pool", undefined, "/entertainment");

    if (statusPayload?.hasCheckedIn) {
      checkin = summarizeIncudalCheckinPayload({
        code: "CHECKIN_ALREADY_TODAY",
        error: "You have already checked in today"
      }, statusPayload, poolPayload);
    } else {
      const payload = await incudalApiRequest(account, token, "POST", "/checkin/checkin", {}, "/entertainment");
      checkin = summarizeIncudalCheckinPayload(payload, statusPayload, poolPayload);
    }
  } catch (error) {
    checkin = {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: 0,
      balance: null,
      raw: null
    };
  }

  checkin = {
    ...checkin,
    attemptCount: 1,
    maxAttempts: 1,
    retryCount: 0,
    attempts: [
      {
        attempt: 1,
        ok: checkin.ok,
        already: checkin.already,
        code: checkin.code,
        message: checkin.message,
        at: formatIso()
      }
    ]
  };

  nextAccount.lastCheckinAt = now;
  nextAccount.lastCheckin = checkin;
  nextAccount.updatedAt = now;

  nextAccount = await refreshIncudalAccountStatus(nextAccount);

  return nextAccount;
}

function readStoredTelegramChatId() {
  try {
    return fs.readFileSync(TELEGRAM_CHAT_ID_FILE, "utf8").trim();
  } catch (error) {
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
  } catch (error) {
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
    throw new Error("无法确定 Telegram chat_id。请先给 @at_xin_bot 发送一条消息，或在 .env 中设置 TELEGRAM_CHAT_ID。");
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
    "GLaDOS 每日签到报告",
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
    if (status?.plan === "Incudal Entertainment") {
      lines.push(
        `资源池: CPU ${status?.pool?.cpu ?? "--"} | 内存 ${status?.pool?.memory ?? "--"} | 磁盘 ${status?.pool?.disk ?? "--"} | 流量 ${status?.pool?.traffic ?? "--"}`
      );
    } else {
      lines.push(
        `剩余天数: ${status?.leftDays ?? "--"} | VIP: ${status?.vip ?? "--"} | Level: ${status?.level ?? "--"}`
      );
    }
    lines.push(`站点: ${account.baseUrl || DEFAULT_BASE_URL}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function buildFailureAlert(results, sentAt) {
  const failedAccounts = results.filter((item) => !item.lastCheckin?.ok);
  if (!failedAccounts.length) {
    return "";
  }

  const lines = [
    "GLaDOS 签到失败告警",
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
      const attemptText = checkin.attempts
        .map((item) => `#${item.attempt}:${item.message}`)
        .join(" | ");
      lines.push(`重试轨迹: ${attemptText}`);
    }

    lines.push("");
  });

  return lines.join("\n").trim();
}

async function main() {
  const startedAt = new Date();
  const gladosAccounts = readAccounts();
  const incudalAccounts = readIncudalAccounts();
  const hasAnyAccounts = gladosAccounts.length || incudalAccounts.length;

  if (!hasAnyAccounts) {
    const report = [
      "每日签到报告",
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
  for (const account of gladosAccounts) {
    nextAccounts.push(await runAccountCheckin(account));
  }
  const nextIncudalAccounts = [];
  for (const account of incudalAccounts) {
    nextIncudalAccounts.push(await runIncudalAccountCheckin(account));
  }

  writeAccounts(nextAccounts);
  writeIncudalAccounts(nextIncudalAccounts);

  const allResults = [...nextAccounts, ...nextIncudalAccounts];

  const report = buildReport(allResults, startedAt);
  console.log(report);

  if (TELEGRAM_BOT_TOKEN) {
    const chatId = await sendTelegramReport(report);
    console.log(`Telegram 已发送到 chat_id=${chatId}`);

    if (TELEGRAM_ALERT_ON_FAILURE) {
      const failureAlert = buildFailureAlert(allResults, startedAt);
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
