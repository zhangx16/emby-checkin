#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

loadLocalEnv();

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");
const TELEGRAM_DRY_RUN = parseBoolean(process.env.TELEGRAM_DRY_RUN, false);
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();

const PROVIDERS = [
  {
    key: "glados",
    label: "GLaDOS",
    accountsFile: path.resolve(process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json")),
    defaultBaseUrl: "https://glados.network",
    balanceLabel: "剩余天数",
    defaultCurrency: "Points"
  },
  {
    key: "embypulse",
    label: "EmbyPulse",
    accountsFile: path.resolve(process.env.EMBYPULSE_ACCOUNTS_FILE || path.join(DATA_DIR, "embypulse_accounts.json")),
    defaultBaseUrl: process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com",
    balanceLabel: "当前积分",
    defaultCurrency: "积分"
  },
  {
    key: "embymb",
    label: "EmbyMB",
    accountsFile: path.resolve(process.env.EMBYMB_ACCOUNTS_FILE || path.join(DATA_DIR, "embymb_accounts.json")),
    defaultBaseUrl: process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com",
    balanceLabel: "当前余额",
    defaultCurrency: "积分"
  },
  {
    key: "zhousanwan",
    label: "周三晚",
    accountsFile: path.resolve(process.env.ZHOUSANWAN_ACCOUNTS_FILE || path.join(DATA_DIR, "zhousanwan_accounts.json")),
    defaultBaseUrl: process.env.DEFAULT_ZHOUSANWAN_BASE_URL || "https://zhousanwan.xyz",
    balanceLabel: "当前余额",
    defaultCurrency: "TOKEN"
  }
];

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

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readWebsiteAccounts() {
  return PROVIDERS.flatMap((provider) =>
    readJsonArray(provider.accountsFile).map((account) => ({
      ...account,
      provider: provider.key,
      providerLabel: provider.label,
      providerConfig: provider,
      baseUrl: account.baseUrl || provider.defaultBaseUrl
    }))
  );
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAmount(value) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(4)));
}

function formatMinorAmount(value) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  return (number / 100).toFixed(2);
}

function dateFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function latestGladosCheckinDate(account) {
  const detail = account.lastCheckin?.raw?.list?.[0]?.detail;
  return typeof detail === "string" && /^\d{4}-\d{2}-\d{2}$/.test(detail) ? detail : "";
}

function getCheckinDate(account) {
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  return (
    status.lastCheckinDate ||
    status.lastSignInDate ||
    checkin.checkinDate ||
    checkin.lastSignInDate ||
    latestGladosCheckinDate(account) ||
    dateFromIso(account.lastCheckinAt) ||
    "--"
  );
}

function getCurrency(account) {
  const config = account.providerConfig || {};
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  return status.currency || checkin.currency || config.defaultCurrency || "";
}

function getRewardText(account) {
  const checkin = account.lastCheckin || {};
  const currency = getCurrency(account);

  if (account.provider === "zhousanwan") {
    return `${formatMinorAmount(checkin.points)} ${currency || "TOKEN"}`;
  }

  if (account.provider === "embypulse") {
    return `${formatAmount(checkin.reward ?? checkin.points)} ${currency || "积分"}`;
  }

  if (account.provider === "embymb") {
    return `${formatAmount(checkin.points)} ${currency || "积分"}`;
  }

  return `${formatAmount(checkin.points)} ${currency || "Points"}`;
}

function getCheckinLabel(account) {
  const checkin = account.lastCheckin;
  if (!checkin) return "未执行";

  if (checkin.ok) {
    if (checkin.already) {
      return `今日已签 · ${checkin.message || "今天已经签到过了"}`;
    }
    return `签到成功 · +${getRewardText(account)}`;
  }

  return `签到失败 · ${checkin.message || "未知错误"}`;
}

function getStatusLine(account) {
  const status = account.lastStatus || {};
  if (!status || Object.keys(status).length === 0) return "未获取状态";
  return `${status.state || (status.ok ? "active" : "unknown")} · ${status.message || ""}`.trim();
}

function getBalanceLine(account) {
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  const config = account.providerConfig || {};
  const currency = getCurrency(account);

  if (account.provider === "glados") {
    const leftDays = status.leftDays != null ? formatAmount(status.leftDays) : "--";
    const vip = status.vip ?? "--";
    return `${config.balanceLabel}: ${leftDays} | VIP: ${vip}`;
  }

  if (account.provider === "zhousanwan") {
    const balance = status.balance ?? checkin.balanceText ?? (checkin.balance != null ? formatMinorAmount(checkin.balance) : "--");
    return `${config.balanceLabel}: ${balance} ${currency || "TOKEN"}`;
  }

  const balance = status.points ?? checkin.balance ?? checkin.currentPoints ?? "--";
  return `${config.balanceLabel}: ${balance} ${currency}`.trim();
}

function summarize(items) {
  return {
    total: items.length,
    success: items.filter((item) => item.lastCheckin?.ok && !item.lastCheckin?.already).length,
    already: items.filter((item) => item.lastCheckin?.already).length,
    failed: items.filter((item) => !item.lastCheckin?.ok).length,
    active: items.filter((item) => item.lastStatus?.state === "active" || item.lastStatus?.ok === true).length
  };
}

function buildReport(accounts, sentAt) {
  const summary = summarize(accounts);
  const providerGroups = PROVIDERS.map((provider) => ({
    provider,
    accounts: accounts.filter((account) => account.provider === provider.key)
  })).filter((group) => group.accounts.length > 0);

  const lines = [
    "网站每日签到汇总",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `网站数: ${providerGroups.length}`,
    `账号总数: ${summary.total}`,
    `签到成功: ${summary.success}`,
    `今日已签: ${summary.already}`,
    `签到失败: ${summary.failed}`,
    `状态正常: ${summary.active}`,
    ""
  ];

  for (const group of providerGroups) {
    const groupSummary = summarize(group.accounts);
    lines.push(`${group.provider.label}: ${groupSummary.total} 个账号，成功 ${groupSummary.success}，已签 ${groupSummary.already}，失败 ${groupSummary.failed}`);

    for (const account of group.accounts) {
      lines.push(`- ${account.name || account.username || account.id || group.provider.label}`);
      lines.push(`  站点: ${account.baseUrl || group.provider.defaultBaseUrl}`);
      lines.push(`  签到: ${getCheckinLabel(account)}`);
      lines.push(`  状态: ${getStatusLine(account)}`);
      lines.push(`  ${getBalanceLine(account)}`);
      lines.push(`  最近签到日: ${getCheckinDate(account)}`);
      lines.push(`  最后更新时间: ${account.updatedAt || account.lastStatusAt || account.lastCheckinAt || "--"}`);
    }

    lines.push("");
  }

  if (!providerGroups.length) {
    lines.push("没有网站签到账号记录。");
  }

  return lines.join("\n").trim();
}

async function main() {
  const sentAt = new Date();
  const accounts = readWebsiteAccounts();
  const report = buildReport(accounts, sentAt);
  console.log(report);

  try {
    const chatId = await sendTelegramReport(report);
    console.log(`[website-checkin-summary] telegram delivered to ${chatId}`);
  } catch (error) {
    console.error(`[website-checkin-summary] telegram delivery failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[website-checkin-summary] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
