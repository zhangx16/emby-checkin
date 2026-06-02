const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

loadLocalEnv();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 22821);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_GLADOS_BASE_URL = "https://glados.network";
const DEFAULT_EMBYPULSE_BASE_URL =
  process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com";
const DEFAULT_INCUDAL_BASE_URL = "https://incudal.com";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-this-password";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const INCUDAL_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const DATA_DIR = path.join(__dirname, "data");
const GLADOS_ACCOUNTS_FILE = path.resolve(
  process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json")
);
const EMBYPULSE_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYPULSE_ACCOUNTS_FILE || path.join(DATA_DIR, "embypulse_accounts.json")
);
const INCUDAL_ACCOUNTS_FILE = path.resolve(
  process.env.INCUDAL_ACCOUNTS_FILE || path.join(DATA_DIR, "incudal_accounts.json")
);
const EMBYKEEPER_DIR = path.join(DATA_DIR, "embykeeper");
const EMBYKEEPER_CONFIG_FILE = path.join(EMBYKEEPER_DIR, "config.toml");
const EMBYKEEPER_FORM_FILE = path.join(EMBYKEEPER_DIR, "form.json");
const EMBYKEEPER_RUNTIME_DIR = path.join(EMBYKEEPER_DIR, "runtime");
const EMBYKEEPER_VENV_DIR = path.join(__dirname, ".venv-embykeeper");
const EMBYKEEPER_BIN = path.join(EMBYKEEPER_VENV_DIR, "bin", "embykeeper");
const EMBYKEEPER_RUNNER = path.join(__dirname, "scripts", "embykeeper_run_once.sh");
const CUSTOM_TG_WORKER = path.join(__dirname, "scripts", "telegram_bot_checkin.py");
const PUBLIC_DIR = path.join(__dirname, "public");
const LOGIN_PAGE = path.join(PUBLIC_DIR, "login.html");
const PROVIDER_LABELS = {
  glados: "GLaDOS",
  embypulse: "EmbyPulse",
  incudal: "Incudal"
};
const EMBYKEEPER_BUILTIN_CHECKINERS = {
  gymeowfly_bot: "meow",
  LembyPremium_BOT: "lemby",
  JingzheProbot: "jingzhe",
  YounoEmbyAgain_bot: "youno"
};

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
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

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function formatDateTime(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureJsonArrayFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  ensureJsonArrayFile(GLADOS_ACCOUNTS_FILE);
  ensureJsonArrayFile(EMBYPULSE_ACCOUNTS_FILE);
  ensureJsonArrayFile(INCUDAL_ACCOUNTS_FILE);
  if (!fs.existsSync(EMBYKEEPER_DIR)) {
    fs.mkdirSync(EMBYKEEPER_DIR, { recursive: true });
  }
  if (!fs.existsSync(EMBYKEEPER_RUNTIME_DIR)) {
    fs.mkdirSync(EMBYKEEPER_RUNTIME_DIR, { recursive: true });
  }
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizeStoredAccount(account, provider) {
  return {
    ...account,
    provider,
    insecureTls: Boolean(account?.insecureTls)
  };
}

function serializeAccountForStorage(account) {
  const {
    provider,
    providerLabel,
    authPreview,
    ...rest
  } = account || {};
  return rest;
}

function readAccounts() {
  ensureDataFiles();

  const gladosAccounts = readJsonArray(GLADOS_ACCOUNTS_FILE).map((item) =>
    normalizeStoredAccount(item, "glados")
  );
  const embypulseAccounts = readJsonArray(EMBYPULSE_ACCOUNTS_FILE).map((item) =>
    normalizeStoredAccount(item, "embypulse")
  );
  const incudalAccounts = readJsonArray(INCUDAL_ACCOUNTS_FILE).map((item) =>
    normalizeStoredAccount(item, "incudal")
  );

  return [...incudalAccounts, ...embypulseAccounts, ...gladosAccounts];
}

function writeAccounts(accounts) {
  ensureDataFiles();
  const gladosAccounts = accounts
    .filter((item) => (item.provider || "glados") === "glados")
    .map(serializeAccountForStorage);
  const embypulseAccounts = accounts
    .filter((item) => (item.provider || "glados") === "embypulse")
    .map(serializeAccountForStorage);
  const incudalAccounts = accounts
    .filter((item) => (item.provider || "glados") === "incudal")
    .map(serializeAccountForStorage);

  fs.writeFileSync(GLADOS_ACCOUNTS_FILE, JSON.stringify(gladosAccounts, null, 2));
  fs.writeFileSync(EMBYPULSE_ACCOUNTS_FILE, JSON.stringify(embypulseAccounts, null, 2));
  fs.writeFileSync(INCUDAL_ACCOUNTS_FILE, JSON.stringify(incudalAccounts, null, 2));
}

function normalizeBaseUrl(value, fallback = DEFAULT_GLADOS_BASE_URL) {
  const raw = String(value || "").trim();
  const candidate = raw || fallback;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function cookiePreview(cookie) {
  const trimmed = String(cookie || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 18) {
    return trimmed;
  }

  return `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`;
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "未知";
}

function incudalRequestHeaders(account, token, refererPath = "/entertainment") {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Cookie: account.cookie,
    Origin: normalizeBaseUrl(account.baseUrl, DEFAULT_INCUDAL_BASE_URL),
    Referer: new URL(refererPath, `${normalizeBaseUrl(account.baseUrl, DEFAULT_INCUDAL_BASE_URL)}/`).toString(),
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

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureEmbykeeperConfigFile() {
  ensureDataFiles();
  if (!fs.existsSync(EMBYKEEPER_CONFIG_FILE)) {
    fs.writeFileSync(EMBYKEEPER_CONFIG_FILE, "");
  }
}

function readEmbykeeperConfig() {
  ensureEmbykeeperConfigFile();
  return fs.readFileSync(EMBYKEEPER_CONFIG_FILE, "utf8");
}

function writeEmbykeeperConfig(content) {
  ensureEmbykeeperConfigFile();
  fs.writeFileSync(EMBYKEEPER_CONFIG_FILE, String(content || ""), "utf8");
}

function defaultTelegramAccountForm() {
  return {
    phone: "",
    apiId: "",
    apiHash: "",
    session: "",
    enabled: true,
    checkiner: true
  };
}

function defaultBotTemplateForm() {
  return {
    botUsername: "",
    name: "",
    commands: ["/checkin"],
    successKeywords: ["签到成功", "今日已签到", "今天已经签到过了", "success"],
    checkedKeywords: ["今日已签到", "今天已经签到过了"],
    failKeywords: ["失败", "错误", "error", "invalid"],
    textIgnore: [],
    targetPhones: [],
    sendInterval: 3,
    useCaptcha: true,
    isChat: false,
    waitResponse: true
  };
}

function defaultEmbykeeperForm() {
  return {
    telegramAccounts: [defaultTelegramAccountForm()],
    botTemplates: [defaultBotTemplateForm()],
    globalCheckiner: {
      timeout: 120,
      retries: 4,
      concurrency: 1,
      randomStart: 60,
      intervalDays: "1",
      timeRange: "<11:00AM,11:00PM>"
    }
  };
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback.slice();
}

function normalizeEmbykeeperForm(body = {}) {
  const source = body && typeof body === "object" ? body : {};
  const defaults = defaultEmbykeeperForm();

  const telegramAccountsRaw = Array.isArray(source.telegramAccounts) ? source.telegramAccounts : defaults.telegramAccounts;
  const telegramAccounts = telegramAccountsRaw.map((item) => ({
    phone: String(item?.phone || "").trim(),
    apiId: String(item?.apiId || item?.api_id || "").trim(),
    apiHash: String(item?.apiHash || item?.api_hash || "").trim(),
    session: String(item?.session || "").trim(),
    enabled: item?.enabled !== false,
    checkiner: item?.checkiner !== false
  })).filter((item) => item.phone);

  const botTemplatesRaw = Array.isArray(source.botTemplates) ? source.botTemplates : defaults.botTemplates;
  const botTemplates = botTemplatesRaw.map((item) => ({
    botUsername: String(item?.botUsername || item?.bot_username || "").trim(),
    name: String(item?.name || "").trim(),
    commands: normalizeStringArray(item?.commands || item?.botCheckinCmd || item?.bot_checkin_cmd, ["/checkin"]),
    successKeywords: normalizeStringArray(item?.successKeywords || item?.botSuccessKeywords || item?.bot_success_keywords, defaults.botTemplates[0].successKeywords),
    checkedKeywords: normalizeStringArray(item?.checkedKeywords || item?.botCheckedKeywords || item?.bot_checked_keywords, defaults.botTemplates[0].checkedKeywords),
    failKeywords: normalizeStringArray(item?.failKeywords || item?.botFailKeywords || item?.bot_fail_keywords, defaults.botTemplates[0].failKeywords),
    textIgnore: normalizeStringArray(item?.textIgnore || item?.botTextIgnore || item?.bot_text_ignore, []),
    targetPhones: normalizeStringArray(item?.targetPhones || item?.target_phones || item?.botTargetPhones || item?.bot_target_phones, []),
    sendInterval: Math.max(1, Number(item?.sendInterval ?? item?.botSendInterval ?? item?.bot_send_interval ?? 3) || 3),
    useCaptcha: item?.useCaptcha !== false,
    isChat: Boolean(item?.isChat),
    waitResponse: item?.waitResponse !== false
  })).filter((item) => item.botUsername);

  const globalCheckinerSource = source.globalCheckiner && typeof source.globalCheckiner === "object"
    ? source.globalCheckiner
    : defaults.globalCheckiner;

  return {
    telegramAccounts: telegramAccounts.length ? telegramAccounts : defaults.telegramAccounts,
    botTemplates: botTemplates.length ? botTemplates : defaults.botTemplates,
    globalCheckiner: {
      timeout: Math.max(10, Number(globalCheckinerSource.timeout ?? defaults.globalCheckiner.timeout) || defaults.globalCheckiner.timeout),
      retries: Math.max(1, Number(globalCheckinerSource.retries ?? defaults.globalCheckiner.retries) || defaults.globalCheckiner.retries),
      concurrency: Math.max(1, Number(globalCheckinerSource.concurrency ?? defaults.globalCheckiner.concurrency) || defaults.globalCheckiner.concurrency),
      randomStart: Math.max(0, Number(globalCheckinerSource.randomStart ?? defaults.globalCheckiner.randomStart) || defaults.globalCheckiner.randomStart),
      intervalDays: String(globalCheckinerSource.intervalDays ?? defaults.globalCheckiner.intervalDays).trim() || defaults.globalCheckiner.intervalDays,
      timeRange: String(globalCheckinerSource.timeRange ?? defaults.globalCheckiner.timeRange).trim() || defaults.globalCheckiner.timeRange
    }
  };
}

function readEmbykeeperForm() {
  ensureDataFiles();
  if (!fs.existsSync(EMBYKEEPER_FORM_FILE)) {
    return defaultEmbykeeperForm();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(EMBYKEEPER_FORM_FILE, "utf8"));
    return normalizeEmbykeeperForm(parsed);
  } catch {
    return defaultEmbykeeperForm();
  }
}

function writeEmbykeeperForm(form) {
  ensureDataFiles();
  fs.writeFileSync(EMBYKEEPER_FORM_FILE, JSON.stringify(form, null, 2));
}

function tomlEscape(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function tomlString(value) {
  return `"${tomlEscape(value)}"`;
}

function tomlBoolean(value) {
  return value ? "true" : "false";
}

function tomlArray(values = []) {
  return `[${values.map((item) => tomlString(item)).join(", ")}]`;
}

function renderEmbykeeperConfigFromForm(formInput) {
  const form = normalizeEmbykeeperForm(formInput);
  const checkinerNames = form.botTemplates.map((item) => {
    const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[item.botUsername];
    return builtin || `templ_b<${item.botUsername}>`;
  });
  const lines = [
    "# emby-keeper Telegram bot check-in config",
    "# Generated by checkin panel",
    ""
  ];

  lines.push("[site]");
  lines.push(`checkiner = ${tomlArray(checkinerNames)}`);
  lines.push("");

  lines.push("[checkiner]");
  lines.push(`time_range = ${tomlString(form.globalCheckiner.timeRange)}`);
  lines.push(`interval_days = ${tomlString(form.globalCheckiner.intervalDays)}`);
  lines.push(`timeout = ${form.globalCheckiner.timeout}`);
  lines.push(`retries = ${form.globalCheckiner.retries}`);
  lines.push(`concurrency = ${form.globalCheckiner.concurrency}`);
  lines.push(`random_start = ${form.globalCheckiner.randomStart}`);
  lines.push("");

  for (const account of form.telegramAccounts) {
    lines.push("[[telegram.account]]");
    lines.push(`phone = ${tomlString(account.phone)}`);
    lines.push(`checkiner = ${tomlBoolean(account.checkiner)}`);
    lines.push(`enabled = ${tomlBoolean(account.enabled)}`);
    if (account.apiId) lines.push(`api_id = ${tomlString(account.apiId)}`);
    if (account.apiHash) lines.push(`api_hash = ${tomlString(account.apiHash)}`);
    if (account.session) lines.push(`session = ${tomlString(account.session)}`);
    lines.push("");
  }

  for (const bot of form.botTemplates) {
    const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[bot.botUsername];
    const key = builtin || `templ_b<${bot.botUsername}>`;
    lines.push(`[checkiner.${tomlString(key)}]`);
    if (bot.name) lines.push(`name = ${tomlString(bot.name)}`);
    lines.push(`bot_checkin_cmd = ${tomlArray(bot.commands)}`);
    lines.push(`bot_send_interval = ${bot.sendInterval}`);
    lines.push(`bot_use_captcha = ${tomlBoolean(bot.useCaptcha)}`);
    lines.push(`bot_success_keywords = ${tomlArray(bot.successKeywords)}`);
    lines.push(`bot_checked_keywords = ${tomlArray(bot.checkedKeywords)}`);
    lines.push(`bot_fail_keywords = ${tomlArray(bot.failKeywords)}`);
    if (bot.textIgnore.length) lines.push(`bot_text_ignore = ${tomlArray(bot.textIgnore)}`);
    lines.push(`is_chat = ${tomlBoolean(bot.isChat)}`);
    lines.push(`wait_response = ${tomlBoolean(bot.waitResponse)}`);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function getEmbykeeperStatus() {
  ensureDataFiles();
  const runtimeFiles = fs.existsSync(EMBYKEEPER_RUNTIME_DIR)
    ? fs.readdirSync(EMBYKEEPER_RUNTIME_DIR)
    : [];
  const sessionFiles = runtimeFiles.filter((name) => !name.startsWith("."));
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(EMBYKEEPER_RUNTIME_DIR, "cache.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  const sessionStrings = cache?.telegram?.session_str || {};
  const sessionStringCount = Object.keys(sessionStrings).length;

  return {
    installed: fs.existsSync(EMBYKEEPER_BIN),
    runnerExists: fs.existsSync(EMBYKEEPER_RUNNER),
    customWorkerExists: fs.existsSync(CUSTOM_TG_WORKER),
    configExists: fs.existsSync(EMBYKEEPER_CONFIG_FILE),
    runtimeDirExists: fs.existsSync(EMBYKEEPER_RUNTIME_DIR),
    sessionFiles,
    sessionStringCount,
    binaryPath: EMBYKEEPER_BIN,
    configPath: EMBYKEEPER_CONFIG_FILE,
    runtimeDir: EMBYKEEPER_RUNTIME_DIR,
    runnerPath: CUSTOM_TG_WORKER,
    firstRunHint: EMBYKEEPER_RUNNER
  };
}

function runEmbykeeperOnce() {
  return new Promise((resolve) => {
    const status = getEmbykeeperStatus();
    if (!status.customWorkerExists) {
      resolve({ ok: false, output: "", error: "Telegram 自定义签到 worker 不存在" });
      return;
    }
    if (!status.sessionStringCount) {
      resolve({ ok: false, output: "", error: "缺少 Telegram 会话，请先执行首次登录" });
      return;
    }

    const child = spawn(path.join(EMBYKEEPER_VENV_DIR, "bin", "python"), [CUSTOM_TG_WORKER], {
      cwd: __dirname,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        output,
        error: "自定义 Telegram Bot 签到运行超时"
      });
    }, 90000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        output,
        error: code === 0 ? "" : `emby-keeper exited with code ${code}`
      });
    });
  });
}

function toPublicAccount(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  return {
    id: account.id,
    provider,
    providerLabel: providerLabel(provider),
    name: account.name,
    baseUrl: account.baseUrl,
    notes: account.notes || "",
    createdAt: account.createdAt || "",
    updatedAt: account.updatedAt || "",
    authPreview: provider === "embypulse"
      ? `账号: ${account.username || "未保存"}`
      : `Cookie: ${cookiePreview(account.cookie) || "未保存"}`,
    lastStatusAt: account.lastStatusAt || "",
    lastStatus: account.lastStatus || null,
    lastCheckinAt: account.lastCheckinAt || "",
    lastCheckin: account.lastCheckin || null
  };
}

function toPublicAccountDetail(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  return {
    ...toPublicAccount(account),
    cookie: account.cookie || "",
    username: account.username || "",
    password: account.password || "",
    insecureTls: Boolean(account.insecureTls),
    provider
  };
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return [
    "tomorrow",
    "already",
    "checked in",
    "已签到",
    "明天",
    "重复"
  ].some((marker) => lowered.includes(marker));
}

function normalizeProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "embypulse") return "embypulse";
  if (raw === "incudal") return "incudal";
  return "glados";
}

function normalizeAccountInput(body = {}, current = {}) {
  const provider = normalizeProvider(body.provider ?? current.provider ?? "glados");
  const name = String(body.name ?? current.name ?? "").trim();
  const cookie = String(body.cookie ?? current.cookie ?? "").trim();
  const username = String(body.username ?? current.username ?? "").trim();
  const password = String(body.password ?? current.password ?? "").trim();
  const insecureTls = Boolean(body.insecureTls ?? current.insecureTls ?? false);
  const baseFallback = provider === "embypulse"
    ? DEFAULT_EMBYPULSE_BASE_URL
    : provider === "incudal"
      ? DEFAULT_INCUDAL_BASE_URL
      : DEFAULT_GLADOS_BASE_URL;

  return {
    ...current,
    id: current.id || crypto.randomUUID(),
    provider,
    name,
    baseUrl: normalizeBaseUrl(body.baseUrl ?? current.baseUrl ?? baseFallback, baseFallback),
    cookie: provider === "glados" || provider === "incudal" ? cookie : "",
    username: provider === "embypulse" ? username : "",
    password: provider === "embypulse" ? password : "",
    insecureTls: provider === "embypulse" ? insecureTls : false,
    notes: String(body.notes ?? current.notes ?? "").trim(),
    createdAt: current.createdAt || formatDateTime(),
    updatedAt: formatDateTime(),
    lastStatusAt: current.lastStatusAt || "",
    lastStatus: current.lastStatus || null,
    lastCheckinAt: current.lastCheckinAt || "",
    lastCheckin: current.lastCheckin || null
  };
}

function validateAccount(account) {
  if (!account.name) {
    return "账号名称不能为空";
  }

  if (account.provider === "embypulse") {
    if (!account.username) {
      return "用户名不能为空";
    }
    if (!account.password) {
      return "密码不能为空";
    }
  } else if (!account.cookie) {
    return "Cookie 不能为空";
  }

  try {
    new URL(account.baseUrl);
  } catch (error) {
    return "站点地址格式不正确";
  }

  return "";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(message);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return acc;
      }

      const key = part.slice(0, index);
      const value = decodeURIComponent(part.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
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

function maybeAllowInsecureTls(account) {
  if (account?.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}

function calculateDaysUntil(dateText) {
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const diff = parsed.getTime() - Date.now();
  return (diff / (1000 * 60 * 60 * 24)).toFixed(2);
}

function signSession(username) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(username).digest("hex");
}

function isHttpsRequest(req) {
  return req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies.glados_user === ADMIN_USER && cookies.glados_token === signSession(ADMIN_USER);
}

function authCookieParts(req, maxAge) {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isHttpsRequest(req)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function setAuthCookies(req, res) {
  const cookieParts = authCookieParts(req, 60 * 60 * 24 * 30);
  res.setHeader("Set-Cookie", [
    `glados_user=${encodeURIComponent(ADMIN_USER)}; ${cookieParts}`,
    `glados_token=${signSession(ADMIN_USER)}; ${cookieParts}`
  ]);
}

function clearAuthCookies(req, res) {
  const cookieParts = authCookieParts(req, 0);
  res.setHeader("Set-Cookie", [
    `glados_user=; ${cookieParts}`,
    `glados_token=; ${cookieParts}`
  ]);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 3 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
  });
  fs.createReadStream(filePath).pipe(res);
}

function requireAuth(req, res, url) {
  if (isAuthenticated(req)) {
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 401, { error: "Unauthorized" });
    return false;
  }

  res.writeHead(302, { Location: "/login" });
  res.end();
  return false;
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

async function embypulseLogin(account) {
  maybeAllowInsecureTls(account);

  const baseUrl = normalizeBaseUrl(account.baseUrl, DEFAULT_EMBYPULSE_BASE_URL);
  const loginUrl = new URL("/api/requests/auth", `${baseUrl}/`);
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({
      username: account.username,
      password: account.password
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { status: "error", message: raw.slice(0, 180) };
  }

  if (!response.ok || data?.status !== "success") {
    throw new Error(data?.message || `登录失败 HTTP ${response.status}`);
  }

  const cookie = buildCookieHeaderFromSetCookie(response.headers);
  if (!cookie) {
    throw new Error("登录成功但未获得会话 Cookie");
  }

  return {
    baseUrl,
    cookie
  };
}

async function embypulseApiRequest(session, method, routePath, payload) {
  const url = new URL(routePath.replace(/^\//, ""), `${session.baseUrl}/`);
  const headers = {
    Accept: "application/json",
    Cookie: session.cookie,
    Origin: session.baseUrl,
    Referer: `${session.baseUrl}/`,
    "User-Agent": USER_AGENT
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { status: "error", message: raw.slice(0, 180) };
  }

  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }

  return data;
}

async function embypulseCheckSession(session) {
  return await embypulseApiRequest(session, "GET", "/api/requests/check");
}

async function incudalRefreshToken(account) {
  const data = await incudalApiRequest(account, null, "POST", "/auth/refresh", {}, "/dashboard");
  if (!data?.token) {
    throw new Error("Incudal refresh 成功但未返回 token");
  }
  return {
    baseUrl: normalizeBaseUrl(account.baseUrl, DEFAULT_INCUDAL_BASE_URL),
    token: data.token
  };
}

async function incudalApiRequest(account, session, method, routePath, payload, refererPath = "/entertainment") {
  const baseUrl = normalizeBaseUrl(account.baseUrl, DEFAULT_INCUDAL_BASE_URL);
  const url = new URL(routePath.replace(/^\//, ""), `${baseUrl}/api/`).toString();
  const marker = "__INCUDAL_HTTP__:";
  const headers = {
    ...incudalRequestHeaders(account, session?.token || "", refererPath),
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
    throw new Error(`Incudal 接口返回异常: ${body.slice(0, 180)}`);
  }

  if (!Number.isFinite(statusCode) || statusCode >= 400) {
    throw new Error(data?.error || data?.message || data?.code || `HTTP ${statusCode}`);
  }

  return data;
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

function summarizeEmbypulseStatusPayload(payload, sessionPayload) {
  if (payload?.status === "success") {
    return {
      ok: true,
      code: 0,
      state: "active",
      message: payload?.data?.has_checked_in ? "今日已签到" : "可签到",
      leftDays: calculateDaysUntil(sessionPayload?.user?.expire_date),
      vip: null,
      level: null,
      plan: "EmbyPulse",
      points: Number(payload?.data?.points ?? 0),
      expireDate: sessionPayload?.user?.expire_date || "",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: payload?.message || "积分状态获取失败",
    leftDays: calculateDaysUntil(sessionPayload?.user?.expire_date),
    vip: null,
    level: null,
    plan: "EmbyPulse",
    points: null,
    expireDate: sessionPayload?.user?.expire_date || "",
    raw: cloneData(payload)
  };
}

function summarizeEmbypulseCheckinPayload(payload, infoPayload) {
  const message = String(payload?.message || "");

  if (payload?.status === "success") {
    return {
      ok: true,
      already: false,
      code: 0,
      message: message || "签到成功",
      points: Number(payload?.reward ?? 0),
      balance: Number(payload?.balance ?? infoPayload?.data?.points ?? 0),
      raw: cloneData(payload)
    };
  }

  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      code: 0,
      message: message || "今天已经签到过了",
      points: 0,
      balance: Number(infoPayload?.data?.points ?? 0),
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: null,
    message: message || "签到失败",
    points: 0,
    balance: Number(infoPayload?.data?.points ?? 0),
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
      gift: payload?.from || "",
      boarding: payload?.boarding || "",
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
  if ((account.provider || "glados") === "incudal") {
    const now = formatDateTime();
    let status;

    try {
      const session = await incudalRefreshToken(account);
      const [checkinStatus, mePayload, poolPayload] = await Promise.all([
        incudalApiRequest(account, session, "GET", "/checkin/status", undefined, "/entertainment"),
        incudalApiRequest(account, session, "GET", "/auth/me", undefined, "/dashboard"),
        incudalApiRequest(account, session, "GET", "/resource-pool", undefined, "/entertainment")
      ]);
      status = summarizeIncudalStatus(checkinStatus, mePayload, poolPayload);
    } catch (error) {
      status = {
        ok: false,
        code: null,
        state: "error",
        message: error.message,
        points: null,
        raw: null
      };
    }

    const nextAccount = {
      ...account,
      lastStatusAt: now,
      lastStatus: status,
      updatedAt: now
    };

    return {
      account: nextAccount,
      summary: {
        id: nextAccount.id,
        name: nextAccount.name,
        status
      }
    };
  }

  if ((account.provider || "glados") === "embypulse") {
    const now = formatDateTime();
    let status;

    try {
      const session = await embypulseLogin(account);
      const sessionPayload = await embypulseCheckSession(session);
      const payload = await embypulseApiRequest(session, "GET", "/api/user/points/info");
      status = summarizeEmbypulseStatusPayload(payload, sessionPayload);
    } catch (error) {
      status = {
        ok: false,
        code: null,
        state: "error",
        message: error.message,
        points: null,
        expireDate: "",
        raw: null
      };
    }

    const nextAccount = {
      ...account,
      lastStatusAt: now,
      lastStatus: status,
      updatedAt: now
    };

    return {
      account: nextAccount,
      summary: {
        id: nextAccount.id,
        name: nextAccount.name,
        status
      }
    };
  }

  const now = formatDateTime();
  let nextAccount = { ...account };
  let result;

  try {
    const payload = await gladosApiRequest(account, "GET", "user/status");
    result = summarizeStatusPayload(payload);
  } catch (error) {
    result = {
      ok: false,
      code: null,
      state: "error",
      message: error.message,
      raw: null
    };
  }

  nextAccount = {
    ...nextAccount,
    lastStatusAt: now,
    lastStatus: result,
    updatedAt: now
  };

  return {
    account: nextAccount,
    summary: {
      id: nextAccount.id,
      name: nextAccount.name,
      status: result
    }
  };
}

async function runAccountCheckin(account) {
  if ((account.provider || "glados") === "incudal") {
    const now = formatDateTime();
    let nextAccount = { ...account };
    let checkin;

    try {
      const session = await incudalRefreshToken(account);
      const statusPayload = await incudalApiRequest(account, session, "GET", "/checkin/status", undefined, "/entertainment");
      const poolPayload = await incudalApiRequest(account, session, "GET", "/resource-pool", undefined, "/entertainment");

      if (statusPayload?.hasCheckedIn) {
        checkin = summarizeIncudalCheckinPayload({
          code: "CHECKIN_ALREADY_TODAY",
          error: "You have already checked in today"
        }, statusPayload, poolPayload);
      } else {
        const payload = await incudalApiRequest(account, session, "POST", "/checkin/checkin", {}, "/entertainment");
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

    nextAccount = {
      ...nextAccount,
      lastCheckinAt: now,
      lastCheckin: checkin,
      updatedAt: now
    };

    nextAccount = (await refreshAccountStatus(nextAccount)).account;

    return {
      account: nextAccount,
      summary: {
        id: nextAccount.id,
        name: nextAccount.name,
        checkin,
        status: nextAccount.lastStatus || null
      }
    };
  }

  if ((account.provider || "glados") === "embypulse") {
    const now = formatDateTime();
    let nextAccount = { ...account };
    let checkin;

    try {
      const session = await embypulseLogin(account);
      const infoPayload = await embypulseApiRequest(session, "GET", "/api/user/points/info");

      if (Boolean(infoPayload?.data?.has_checked_in)) {
        checkin = summarizeEmbypulseCheckinPayload({
          status: "error",
          message: "今天已经签到过了，明天再来吧！"
        }, infoPayload);
      } else {
        const payload = await embypulseApiRequest(session, "POST", "/api/user/points/checkin");
        checkin = summarizeEmbypulseCheckinPayload(payload, infoPayload);
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

    nextAccount = {
      ...nextAccount,
      lastCheckinAt: now,
      lastCheckin: checkin,
      updatedAt: now
    };

    nextAccount = (await refreshAccountStatus(nextAccount)).account;

    return {
      account: nextAccount,
      summary: {
        id: nextAccount.id,
        name: nextAccount.name,
        checkin,
        status: nextAccount.lastStatus || null
      }
    };
  }

  const now = formatDateTime();
  let nextAccount = { ...account };
  let checkin;

  try {
    const host = new URL(normalizeBaseUrl(account.baseUrl)).hostname;
    const payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host });
    checkin = summarizeCheckinPayload(payload);
  } catch (error) {
    checkin = {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: null,
      raw: null
    };
  }

  nextAccount = {
    ...nextAccount,
    lastCheckinAt: now,
    lastCheckin: checkin,
    updatedAt: now
  };

  if (checkin.ok) {
    const refreshed = await refreshAccountStatus(nextAccount);
    nextAccount = refreshed.account;
  } else if (checkin.code === -2) {
    nextAccount.lastStatusAt = now;
    nextAccount.lastStatus = {
      ok: false,
      code: -2,
      state: "unauthorized",
      message: "Cookie 失效或无权限",
      raw: null
    };
  }

  return {
    account: nextAccount,
    summary: {
      id: nextAccount.id,
      name: nextAccount.name,
      checkin,
      status: nextAccount.lastStatus || null
    }
  };
}

function findAccountOrNull(accounts, id) {
  return accounts.find((item) => item.id === id) || null;
}

async function runBatch(accounts, ids, worker) {
  const idSet = ids?.length ? new Set(ids) : null;
  const selected = idSet ? accounts.filter((item) => idSet.has(item.id)) : accounts.slice();

  if (!selected.length) {
    return {
      accounts,
      results: []
    };
  }

  const updatedById = new Map();
  const results = [];

  for (const account of selected) {
    const processed = await worker(account);
    updatedById.set(processed.account.id, processed.account);
    results.push(processed.summary);
  }

  const nextAccounts = accounts.map((item) => updatedById.get(item.id) || item);
  return {
    accounts: nextAccounts,
    results
  };
}

function getExportData(accounts) {
  return {
    exportedAt: formatDateTime(),
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider || "glados",
      name: account.name,
      baseUrl: account.baseUrl,
      cookie: account.cookie,
      username: account.username || "",
      password: account.password || "",
      insecureTls: Boolean(account.insecureTls),
      notes: account.notes || ""
    }))
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, host: HOST, port: PORT, now: formatDateTime() });
    return;
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await readRequestBody(req);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      sendJson(res, 401, { error: "用户名或密码错误" });
      return;
    }

    setAuthCookies(req, res);
    sendJson(res, 200, { ok: true, username: ADMIN_USER });
    return;
  }

  if (method === "POST" && pathname === "/api/logout") {
    clearAuthCookies(req, res);
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/api/session") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    sendJson(res, 200, { ok: true, username: ADMIN_USER });
    return;
  }

  if (!requireAuth(req, res, url)) {
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/status") {
    sendJson(res, 200, { status: getEmbykeeperStatus() });
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/config") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      config: readEmbykeeperConfig()
    });
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/form") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      form: readEmbykeeperForm()
    });
    return;
  }

  if (method === "PUT" && pathname === "/api/embykeeper/config") {
    const body = await readRequestBody(req);
    writeEmbykeeperConfig(body?.config ?? "");
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus()
    });
    return;
  }

  if (method === "PUT" && pathname === "/api/embykeeper/form") {
    const body = await readRequestBody(req);
    const form = normalizeEmbykeeperForm(body?.form || {});
    writeEmbykeeperForm(form);
    writeEmbykeeperConfig(renderEmbykeeperConfigFromForm(form));
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus(),
      form,
      config: readEmbykeeperConfig()
    });
    return;
  }

  if (method === "POST" && pathname === "/api/embykeeper/run") {
    const result = await runEmbykeeperOnce();
    sendJson(res, result.ok ? 200 : 500, {
      ok: result.ok,
      output: result.output,
      error: result.error,
      status: getEmbykeeperStatus()
    });
    return;
  }

  if (method === "GET" && pathname === "/api/accounts") {
    sendJson(res, 200, { accounts: readAccounts().map(toPublicAccount) });
    return;
  }

  if (method === "GET" && pathname === "/api/accounts/export") {
    const payload = getExportData(readAccounts());
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="checkin-accounts-${Date.now()}.json"`,
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  if (method === "POST" && pathname === "/api/accounts") {
    const body = await readRequestBody(req);
    const nextAccount = normalizeAccountInput(body);
    const error = validateAccount(nextAccount);

    if (error) {
      sendJson(res, 400, { error });
      return;
    }

    const accounts = readAccounts();
    accounts.unshift(nextAccount);
    writeAccounts(accounts);
    sendJson(res, 201, { account: toPublicAccount(nextAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/accounts/import") {
    const body = await readRequestBody(req);
    const incoming = Array.isArray(body?.accounts)
      ? body.accounts
      : Array.isArray(body)
        ? body
        : [];

    if (!incoming.length) {
      sendJson(res, 400, { error: "缺少可导入的 accounts 数组" });
      return;
    }

    const imported = incoming
      .map((item) => normalizeAccountInput(item))
      .filter((item) => !validateAccount(item));

    if (!imported.length) {
      sendJson(res, 400, { error: "没有可导入的有效账号" });
      return;
    }

    const accounts = [...imported, ...readAccounts()];
    writeAccounts(accounts);
    sendJson(res, 201, { accounts: imported.map(toPublicAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/accounts/batch-delete") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];

    if (!ids.length) {
      sendJson(res, 400, { error: "ids 不能为空" });
      return;
    }

    const idSet = new Set(ids);
    const accounts = readAccounts();
    const nextAccounts = accounts.filter((item) => !idSet.has(item.id));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { deletedIds: ids, accounts: nextAccounts.map(toPublicAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/status/refresh") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, refreshAccountStatus);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }

  if (method === "POST" && pathname === "/api/checkin/run") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, runAccountCheckin);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }

  const detailMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (detailMatch) {
    const accountId = detailMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, { account: toPublicAccountDetail(account) });
      return;
    }

    if (method === "PUT") {
      const body = await readRequestBody(req);
      const nextAccount = normalizeAccountInput(body, account);
      const error = validateAccount(nextAccount);

      if (error) {
        sendJson(res, 400, { error });
        return;
      }

      const nextAccounts = accounts.map((item) => (item.id === accountId ? nextAccount : item));
      writeAccounts(nextAccounts);
      sendJson(res, 200, { account: toPublicAccount(nextAccount) });
      return;
    }

    if (method === "DELETE") {
      const nextAccounts = accounts.filter((item) => item.id !== accountId);
      writeAccounts(nextAccounts);
      sendJson(res, 200, { deletedId: accountId, accounts: nextAccounts.map(toPublicAccount) });
      return;
    }
  }

  const statusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/status\/refresh$/);
  if (method === "POST" && statusMatch) {
    const accountId = statusMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    const processed = await refreshAccountStatus(account);
    const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }

  const checkinMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/checkin$/);
  if (method === "POST" && checkinMatch) {
    const accountId = checkinMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    const processed = await runAccountCheckin(account);
    const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/login") {
      if (isAuthenticated(req)) {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(LOGIN_PAGE).pipe(res);
      return;
    }

    if ((url.pathname === "/login.css" || url.pathname === "/login.js") && (req.method === "GET" || req.method === "HEAD")) {
      serveStatic(req, res, url);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    if (!requireAuth(req, res, url)) {
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器内部错误" });
  }
});

server.listen(PORT, HOST, () => {
  ensureDataFiles();
  console.log(`Checkin dashboard listening on http://${HOST}:${PORT}`);
});
