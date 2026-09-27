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
const DEFAULT_EMBYMB_BASE_URL =
  process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";
const DEFAULT_ZHOUSANWAN_BASE_URL =
  process.env.DEFAULT_ZHOUSANWAN_BASE_URL || "https://zhousanwan.xyz";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-this-password";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
/** Mobile / App API token (Bearer or X-API-Key). Empty = token auth disabled (cookie session still works). */
const APP_API_TOKEN = String(process.env.APP_API_TOKEN || process.env.CHECKIN_API_TOKEN || "").trim();
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const GLADOS_DEVICE_USER_AGENTS = {
  Windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  Mac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  macOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  Linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
};

function gladosUserAgent(device) {
  const key = String(device || "").trim();
  return GLADOS_DEVICE_USER_AGENTS[key] || GLADOS_DEVICE_USER_AGENTS.Windows;
}

const DATA_DIR = path.join(__dirname, "data");
const GLADOS_ACCOUNTS_FILE = path.resolve(
  process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json")
);
const EMBYPULSE_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYPULSE_ACCOUNTS_FILE || path.join(DATA_DIR, "embypulse_accounts.json")
);
const EMBYMB_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYMB_ACCOUNTS_FILE || path.join(DATA_DIR, "embymb_accounts.json")
);
const ZHOUSANWAN_ACCOUNTS_FILE = path.resolve(
  process.env.ZHOUSANWAN_ACCOUNTS_FILE || path.join(DATA_DIR, "zhousanwan_accounts.json")
);
const EMBYKEEPER_DIR = path.join(DATA_DIR, "embykeeper");
const EMBYKEEPER_CONFIG_FILE = path.join(EMBYKEEPER_DIR, "config.toml");
const EMBYKEEPER_FORM_FILE = path.join(EMBYKEEPER_DIR, "form.json");
const EMBYKEEPER_RUNTIME_DIR = path.join(EMBYKEEPER_DIR, "runtime");
const TELEGRAM_CHECKIN_RESULTS_FILE = path.join(DATA_DIR, "telegram_bot_checkin_results.json");
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const EMBYKEEPER_VENV_DIR = path.join(__dirname, ".venv-embykeeper");
const EMBYKEEPER_BIN = path.join(EMBYKEEPER_VENV_DIR, "bin", "embykeeper");
const EMBYKEEPER_RUNNER = path.join(__dirname, "scripts", "embykeeper_run_once.sh");
const CUSTOM_TG_WORKER = path.join(__dirname, "scripts", "telegram_bot_checkin.py");
const PUBLIC_DIR = path.join(__dirname, "public");
const BOT_AVATAR_DIR = path.join(PUBLIC_DIR, "bot-avatars");
const SITE_ICON_DIR = path.join(PUBLIC_DIR, "site-icons");
const BOT_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_DEFAULT_BASE = {
  glados: DEFAULT_GLADOS_BASE_URL,
  embypulse: DEFAULT_EMBYPULSE_BASE_URL,
  embymb: DEFAULT_EMBYMB_BASE_URL,
  zhousanwan: DEFAULT_ZHOUSANWAN_BASE_URL
};
const PROVIDER_LABELS = {
  glados: "GLaDOS",
  embypulse: "EmbyPulse",
  embymb: "EmbyMB",
  zhousanwan: "周三晚",
  telegram_bot: "Telegram Bot"
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  ensureJsonArrayFile(EMBYMB_ACCOUNTS_FILE);
  ensureJsonArrayFile(ZHOUSANWAN_ACCOUNTS_FILE);
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
  const embymbAccounts = readJsonArray(EMBYMB_ACCOUNTS_FILE).map((item) =>
    normalizeStoredAccount(item, "embymb")
  );
  const zhousanwanAccounts = readJsonArray(ZHOUSANWAN_ACCOUNTS_FILE).map((item) =>
    normalizeStoredAccount(item, "zhousanwan")
  );

  return [...zhousanwanAccounts, ...embymbAccounts, ...embypulseAccounts, ...gladosAccounts];
}

function writeAccounts(accounts) {
  ensureDataFiles();
  const gladosAccounts = accounts
    .filter((item) => (item.provider || "glados") === "glados")
    .map(serializeAccountForStorage);
  const embypulseAccounts = accounts
    .filter((item) => (item.provider || "glados") === "embypulse")
    .map(serializeAccountForStorage);
  const embymbAccounts = accounts
    .filter((item) => (item.provider || "glados") === "embymb")
    .map(serializeAccountForStorage);
  const zhousanwanAccounts = accounts
    .filter((item) => (item.provider || "glados") === "zhousanwan")
    .map(serializeAccountForStorage);

  fs.writeFileSync(GLADOS_ACCOUNTS_FILE, JSON.stringify(gladosAccounts, null, 2));
  fs.writeFileSync(EMBYPULSE_ACCOUNTS_FILE, JSON.stringify(embypulseAccounts, null, 2));
  fs.writeFileSync(EMBYMB_ACCOUNTS_FILE, JSON.stringify(embymbAccounts, null, 2));
  fs.writeFileSync(ZHOUSANWAN_ACCOUNTS_FILE, JSON.stringify(zhousanwanAccounts, null, 2));
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

function isPasswordProvider(provider) {
  return ["embypulse", "embymb", "zhousanwan"].includes(provider);
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

function readTelegramCheckinResults() {
  ensureDataFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
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
    authPreview: isPasswordProvider(provider)
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

/** Mobile-safe account detail: never return raw password; cookie returned for edit forms. */
function toMobileAccountDetail(account) {
  const publicAccount = toPublicAccount(account);
  const provider = publicAccount.provider;
  return {
    ...publicAccount,
    baseUrl: account.baseUrl || "",
    cookie: provider === "glados" ? account.cookie || "" : "",
    username: isPasswordProvider(provider) ? account.username || "" : "",
    hasPassword: Boolean(account.password),
    hasCookie: Boolean(account.cookie),
    insecureTls: Boolean(account.insecureTls),
    notes: account.notes || ""
  };
}

/** PUT update: empty password/cookie keeps existing secret. */
function normalizeAccountMobileUpdate(body = {}, current = {}) {
  const merged = {
    ...body,
    password:
      body.password === undefined || body.password === null || String(body.password) === ""
        ? current.password
        : body.password,
    cookie:
      body.cookie === undefined || body.cookie === null
        ? current.cookie
        : body.cookie
  };
  return normalizeAccountInput(merged, current);
}

function listMobileTelegramBots() {
  const form = readEmbykeeperForm();
  const results = readTelegramCheckinResults();
  const bots = (form.botTemplates || []).map((bot) => {
    const username = String(bot.botUsername || "").replace(/^@/, "");
    const result = results?.bots?.[username] || results?.bots?.[bot.botUsername] || null;
    return {
      botUsername: username,
      name: bot.name || username,
      commands: bot.commands || [],
      successKeywords: bot.successKeywords || [],
      checkedKeywords: bot.checkedKeywords || [],
      failKeywords: bot.failKeywords || [],
      sendInterval: bot.sendInterval,
      useCaptcha: bot.useCaptcha,
      isChat: bot.isChat,
      waitResponse: bot.waitResponse,
      targetPhones: bot.targetPhones || [],
      lastStatus: result
        ? {
            ok: result.ok,
            status: result.status,
            message: result.message,
            checkedAt: result.checkedAt
          }
        : null
    };
  });
  return {
    bots,
    phones: (form.telegramAccounts || []).map((a) => ({
      phone: a.phone,
      enabled: a.enabled !== false,
      checkiner: a.checkiner !== false
    }))
  };
}

function persistEmbykeeperForm(form) {
  const normalized = normalizeEmbykeeperForm(form);
  writeEmbykeeperForm(normalized);
  writeEmbykeeperConfig(renderEmbykeeperConfigFromForm(normalized));
  return normalized;
}

function updateMobileTelegramBot(botUsername, body = {}) {
  const form = readEmbykeeperForm();
  const idx = (form.botTemplates || []).findIndex(
    (b) => String(b.botUsername || "").replace(/^@/, "") === botUsername
  );
  if (idx < 0) {
    return { ok: false, error: "Bot 不存在" };
  }
  const current = form.botTemplates[idx];
  form.botTemplates[idx] = {
    ...current,
    name: body.name !== undefined ? String(body.name || "").trim() : current.name,
    botUsername:
      body.botUsername !== undefined
        ? String(body.botUsername || "").trim().replace(/^@/, "")
        : current.botUsername,
    commands: body.commands !== undefined ? normalizeStringArray(body.commands, current.commands) : current.commands,
    successKeywords:
      body.successKeywords !== undefined
        ? normalizeStringArray(body.successKeywords, current.successKeywords)
        : current.successKeywords,
    checkedKeywords:
      body.checkedKeywords !== undefined
        ? normalizeStringArray(body.checkedKeywords, current.checkedKeywords)
        : current.checkedKeywords,
    failKeywords:
      body.failKeywords !== undefined
        ? normalizeStringArray(body.failKeywords, current.failKeywords)
        : current.failKeywords,
    sendInterval:
      body.sendInterval !== undefined
        ? Math.max(1, Number(body.sendInterval) || current.sendInterval || 3)
        : current.sendInterval,
    useCaptcha: body.useCaptcha !== undefined ? Boolean(body.useCaptcha) : current.useCaptcha,
    isChat: body.isChat !== undefined ? Boolean(body.isChat) : current.isChat,
    waitResponse: body.waitResponse !== undefined ? Boolean(body.waitResponse) : current.waitResponse,
    targetPhones:
      body.targetPhones !== undefined
        ? normalizeStringArray(body.targetPhones, current.targetPhones || [])
        : current.targetPhones || []
  };
  if (!form.botTemplates[idx].botUsername) {
    return { ok: false, error: "Bot 用户名不能为空" };
  }
  const saved = persistEmbykeeperForm(form);
  return { ok: true, bot: listMobileTelegramBots().bots.find((b) => b.botUsername === form.botTemplates[idx].botUsername), form: saved };
}

function deleteMobileTelegramBot(botUsername) {
  const form = readEmbykeeperForm();
  const before = (form.botTemplates || []).length;
  form.botTemplates = (form.botTemplates || []).filter(
    (b) => String(b.botUsername || "").replace(/^@/, "") !== botUsername
  );
  if (form.botTemplates.length === before) {
    return { ok: false, error: "Bot 不存在" };
  }
  if (!form.botTemplates.length) {
    form.botTemplates = defaultEmbykeeperForm().botTemplates;
  }
  persistEmbykeeperForm(form);

  // Drop results for this bot so summary refreshes cleanly.
  try {
    const results = readTelegramCheckinResults();
    if (results?.bots) {
      delete results.bots[botUsername];
      delete results.bots[`@${botUsername}`];
      fs.writeFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, JSON.stringify(results, null, 2));
    }
  } catch {
    // ignore
  }
  return { ok: true, deletedBotUsername: botUsername };
}

function deleteMobileTelegramPhone(phone) {
  const form = readEmbykeeperForm();
  const before = (form.telegramAccounts || []).length;
  form.telegramAccounts = (form.telegramAccounts || []).filter((a) => a.phone !== phone);
  if (form.telegramAccounts.length === before) {
    return { ok: false, error: "手机号不存在" };
  }
  if (!form.telegramAccounts.length) {
    form.telegramAccounts = defaultEmbykeeperForm().telegramAccounts;
  }
  persistEmbykeeperForm(form);
  return { ok: true, deletedPhone: phone };
}

/**
 * Remove one phone from a single bot's check-in scope (does NOT delete the TG account globally).
 * Empty targetPhones means "all phones"; we materialize the remaining phones into targetPhones.
 */
function removePhoneFromTelegramBot(botUsername, phone) {
  const user = String(botUsername || "").replace(/^@/, "");
  const form = readEmbykeeperForm();
  const idx = (form.botTemplates || []).findIndex(
    (b) => String(b.botUsername || "").replace(/^@/, "") === user
  );
  if (idx < 0) {
    return { ok: false, error: "Bot 不存在" };
  }
  const bot = form.botTemplates[idx];
  const allPhones = (form.telegramAccounts || [])
    .filter((a) => a.enabled !== false && a.checkiner !== false)
    .map((a) => a.phone)
    .filter(Boolean);
  let targets = Array.isArray(bot.targetPhones) ? bot.targetPhones.filter(Boolean) : [];
  if (!targets.length) {
    targets = allPhones.slice();
  }
  const nextTargets = targets.filter((p) => p !== phone);
  if (nextTargets.length === targets.length) {
    // Phone might only appear in results; still allow cleaning results.
  }
  // If only one phone remains and it equals all remaining accounts, can leave empty (= all remaining).
  form.botTemplates[idx] = {
    ...bot,
    targetPhones: nextTargets
  };
  persistEmbykeeperForm(form);

  // Strip this phone from bot results so summary drops the row immediately.
  try {
    const results = readTelegramCheckinResults();
    const key = user;
    const entry = results?.bots?.[key] || results?.bots?.[bot.botUsername];
    if (entry && Array.isArray(entry.accounts)) {
      entry.accounts = entry.accounts.filter((a) => String(a?.phone || "") !== phone);
      results.bots[key] = entry;
      results.updatedAt = formatDateTime();
      fs.writeFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, JSON.stringify(results, null, 2));
    }
  } catch {
    // ignore
  }
  return { ok: true, botUsername: user, removedPhone: phone, targetPhones: nextTargets };
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return [
    "tomorrow",
    "already",
    "checked in",
    "idempotent",
    "已签到",
    "已经签到",
    "今天已经签到过了",
    "请勿重复签到",
    "重复签到",
    "明天再来",
    "重复"
  ].some((marker) => lowered.includes(marker));
}

function normalizeProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "embypulse") return "embypulse";
  if (raw === "embymb") return "embymb";
  if (raw === "zhousanwan") return "zhousanwan";
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
    : provider === "embymb"
      ? DEFAULT_EMBYMB_BASE_URL
    : provider === "zhousanwan"
      ? DEFAULT_ZHOUSANWAN_BASE_URL
      : DEFAULT_GLADOS_BASE_URL;

  return {
    ...current,
    id: current.id || crypto.randomUUID(),
    provider,
    name,
    baseUrl: normalizeBaseUrl(body.baseUrl ?? current.baseUrl ?? baseFallback, baseFallback),
    cookie: provider === "glados" ? cookie : "",
    username: isPasswordProvider(provider) ? username : "",
    password: isPasswordProvider(provider) ? password : "",
    insecureTls: isPasswordProvider(provider) ? insecureTls : false,
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

  if (isPasswordProvider(account.provider)) {
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
  const pathname = url.pathname;
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

  sendJson(res, 401, { error: "Unauthorized" });
  return false;
}

function extractAppToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer) {
    return bearer[1].trim();
  }
  return String(req.headers["x-api-key"] || "").trim();
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (!left.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isAppTokenAuthorized(req) {
  if (!APP_API_TOKEN) {
    return false;
  }
  return safeEqualString(extractAppToken(req), APP_API_TOKEN);
}

/** Cookie session (web panel) or Bearer / X-API-Key (mobile app). */
function requireAppOrSessionAuth(req, res) {
  if (isAuthenticated(req) || isAppTokenAuthorized(req)) {
    return true;
  }
  sendJson(res, 401, {
    error: "Unauthorized",
    hint: APP_API_TOKEN
      ? "Provide Authorization: Bearer <APP_API_TOKEN> or X-API-Key"
      : "APP_API_TOKEN is not configured; use web session login"
  });
  return false;
}

function emptyStatusCounts() {
  return {
    success: 0,
    already: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    pending: 0
  };
}

function deriveWebsiteItemStatus(account) {
  const checkin = account.lastCheckin || null;
  const status = account.lastStatus || null;

  if (checkin) {
    if (checkin.skipped) return "skipped";
    if (checkin.already === true || isAlreadyCheckedInMessage(checkin.message)) return "already";
    if (checkin.ok === true) return "success";
    if (checkin.ok === false) return "failed";
  }

  if (status) {
    if (status.todaySigned === true) return "already";
    if (status.ok === true && /已签到|already|signed/i.test(String(status.message || ""))) {
      return "already";
    }
    if (status.ok === false) return "failed";
    if (status.ok === true && !account.lastCheckinAt) return "unknown";
  }

  if (!account.lastCheckinAt && !account.lastStatusAt) {
    return "pending";
  }
  return "unknown";
}

function pickNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapWebsiteAccountToSummaryItem(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  const checkin = account.lastCheckin || {};
  const status = account.lastStatus || {};
  const itemStatus = deriveWebsiteItemStatus(account);
  const streak = pickNumber(
    checkin.raw?.data?.current_streak,
    checkin.currentStreak,
    status.currentStreak
  );
  const leftDays = status.leftDays ?? checkin.raw?.data?.leftDays ?? null;
  const pointsDelta = pickNumber(checkin.points, checkin.raw?.data?.daily_points, checkin.raw?.data?.total_today);
  const balance = pickNumber(
    checkin.balance,
    checkin.currentPoints,
    checkin.raw?.data?.current_points,
    checkin.raw?.data?.total_points,
    status.points,
    status.totalPoints
  );

  return {
    id: String(account.id || ""),
    kind: "website",
    provider,
    providerLabel: providerLabel(provider),
    accountName: account.name || "",
    status: itemStatus,
    ok: itemStatus === "success" || itemStatus === "already",
    message: String(checkin.message || status.message || "").trim(),
    checkedAt: account.lastCheckinAt || account.lastStatusAt || "",
    pointsDelta,
    balance,
    currency: String(checkin.currency || status.currency || status.plan || "").trim(),
    streak,
    leftDays: leftDays === null || leftDays === undefined ? null : String(leftDays),
    todaySigned: Boolean(
      checkin.already ||
        checkin.todaySigned ||
        status.todaySigned ||
        itemStatus === "already" ||
        itemStatus === "success"
    ),
    notes: account.notes || ""
  };
}

function ensureBotAvatarDir() {
  if (!fs.existsSync(BOT_AVATAR_DIR)) {
    fs.mkdirSync(BOT_AVATAR_DIR, { recursive: true });
  }
}

function ensureSiteIconDir() {
  if (!fs.existsSync(SITE_ICON_DIR)) {
    fs.mkdirSync(SITE_ICON_DIR, { recursive: true });
  }
}

function detectImageExt(buf, contentType = "") {
  if (buf && buf.length >= 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57) return "webp";
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "ico";
  }
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("icon")) return "ico";
  return "bin";
}

function isProbablyHtml(buf) {
  if (!buf || buf.length < 12) return false;
  const head = buf.slice(0, 64).toString("utf8").toLowerCase();
  return head.includes("<!doctype") || head.includes("<html") || head.includes("<head");
}

async function fetchBinary(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    const ct = response.headers.get("content-type") || "";
    if (isProbablyHtml(buf) || ct.includes("text/html")) return null;
    if (buf.length < 64) return null;
    return { buf, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverIconUrlsFromHtml(origin) {
  const urls = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let html = "";
    try {
      const response = await fetch(`${origin}/`, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" }
      });
      if (!response.ok) return urls;
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }
    const hrefs = [];
    const re = /<link\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      if (!/rel\s*=\s*["'][^"']*icon/i.test(tag) && !/rel\s*=\s*["']apple-touch-icon/i.test(tag)) {
        continue;
      }
      const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch?.[1]) hrefs.push(hrefMatch[1]);
    }
    const og = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
      || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
    if (og?.[1]) hrefs.push(og[1]);

    for (const href of hrefs) {
      try {
        urls.push(new URL(href, `${origin}/`).toString());
      } catch {
        // ignore bad href
      }
    }
  } catch {
    // ignore
  }
  return urls;
}

/**
 * Cache website favicon/logo under public/site-icons/{provider}.{ext}
 * Returns public path like `/site-icons/glados.png` or null.
 */
async function ensureSiteIcon(provider, siteBaseUrl) {
  const key = String(provider || "site").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "site";
  ensureSiteIconDir();

  // Fresh cache?
  try {
    const existing = fs.readdirSync(SITE_ICON_DIR).filter((name) => name.startsWith(`${key}.`) && !name.endsWith(".meta.json"));
    for (const name of existing) {
      const filePath = path.join(SITE_ICON_DIR, name);
      const metaPath = path.join(SITE_ICON_DIR, `${key}.meta.json`);
      if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (meta?.fetchedAt && Date.now() - Number(meta.fetchedAt) < SITE_ICON_TTL_MS) {
          return `/site-icons/${name}`;
        }
      } else if (fs.existsSync(filePath)) {
        // stale without meta still usable as fallback
        return `/site-icons/${name}`;
      }
    }
  } catch {
    // refresh below
  }

  const fallbackBase = PROVIDER_DEFAULT_BASE[key] || DEFAULT_GLADOS_BASE_URL;
  let origin;
  try {
    origin = normalizeBaseUrl(siteBaseUrl || fallbackBase, fallbackBase);
  } catch {
    origin = fallbackBase;
  }
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    host = "";
  }

  // Prefer PNG/JPEG sources first (iOS AsyncImage handles these best).
  const candidates = [
    `${origin}/favicon.png`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/brand/logo.png`,
    `${origin}/logo.png`,
    `${origin}/static/favicon.png`,
    `${origin}/assets/favicon.png`
  ];
  if (host) {
    candidates.push(
      `https://icon.horse/icon/${host}`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`
    );
  }
  candidates.push(
    `${origin}/static/favicon.ico`,
    `${origin}/assets/favicon.ico`,
    `${origin}/favicon.ico`
  );

  // HTML-discovered icons first (higher quality logo/png often).
  const fromHtml = await discoverIconUrlsFromHtml(origin);
  const all = [...fromHtml, ...candidates];

  let icoFallback = null;
  for (const url of all) {
    const got = await fetchBinary(url);
    if (!got) continue;
    // Skip tiny placeholder images (e.g. 1x1).
    if (got.buf.length < 200) continue;
    let ext = detectImageExt(got.buf, got.contentType);
    if (ext === "bin") continue;
    // Prefer non-ICO for mobile; remember ICO as last resort.
    if (ext === "ico") {
      if (!icoFallback) icoFallback = { got, url };
      continue;
    }
    const fileName = `${key}.${ext === "jpeg" ? "jpg" : ext}`;
    const filePath = path.join(SITE_ICON_DIR, fileName);
    try {
      for (const name of fs.readdirSync(SITE_ICON_DIR)) {
        if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
          fs.unlinkSync(path.join(SITE_ICON_DIR, name));
        }
      }
    } catch {
      // ignore
    }
    fs.writeFileSync(filePath, got.buf);
    fs.writeFileSync(
      path.join(SITE_ICON_DIR, `${key}.meta.json`),
      JSON.stringify({ provider: key, origin, source: url, fetchedAt: Date.now() }, null, 2)
    );
    return `/site-icons/${fileName}`;
  }

  if (icoFallback) {
    const fileName = `${key}.ico`;
    const filePath = path.join(SITE_ICON_DIR, fileName);
    try {
      for (const name of fs.readdirSync(SITE_ICON_DIR)) {
        if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
          fs.unlinkSync(path.join(SITE_ICON_DIR, name));
        }
      }
    } catch {
      // ignore
    }
    fs.writeFileSync(filePath, icoFallback.got.buf);
    fs.writeFileSync(
      path.join(SITE_ICON_DIR, `${key}.meta.json`),
      JSON.stringify({ provider: key, origin, source: icoFallback.url, fetchedAt: Date.now() }, null, 2)
    );
    return `/site-icons/${fileName}`;
  }
  return null;
}

function publicBaseFromRequest(req) {
  const host = String(req?.headers?.host || `${HOST}:${PORT}`).trim();
  const proto = isHttpsRequest(req) ? "https" : "http";
  return `${proto}://${host}`;
}

async function telegramBotApi(method, params = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }
  const url = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, 15000));
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error(payload?.description || `Telegram API ${method} failed`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download + cache a Telegram bot profile photo into public/bot-avatars/{username}.jpg
 * Returns public path `/bot-avatars/{username}.jpg` or null.
 */
async function ensureBotAvatar(username) {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user || !TELEGRAM_BOT_TOKEN) {
    return null;
  }

  ensureBotAvatarDir();
  const safe = user.replace(/[^a-zA-Z0-9_]/g, "_");
  const filePath = path.join(BOT_AVATAR_DIR, `${safe}.jpg`);
  const metaPath = path.join(BOT_AVATAR_DIR, `${safe}.meta.json`);
  const publicPath = `/bot-avatars/${safe}.jpg`;

  try {
    if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta?.fetchedAt && Date.now() - Number(meta.fetchedAt) < BOT_AVATAR_TTL_MS) {
        return publicPath;
      }
    }
  } catch {
    // refresh below
  }

  try {
    const chat = await telegramBotApi("getChat", { chat_id: `@${user}` });
    const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id;
    if (!fileId) {
      return fs.existsSync(filePath) ? publicPath : null;
    }
    const file = await telegramBotApi("getFile", { file_id: fileId });
    const filePathRemote = file?.file_path;
    if (!filePathRemote) {
      return fs.existsSync(filePath) ? publicPath : null;
    }
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePathRemote}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, 20000));
    try {
      const response = await fetch(downloadUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`download avatar HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            username: user,
            fetchedAt: Date.now(),
            title: chat?.title || chat?.first_name || user
          },
          null,
          2
        )
      );
      return publicPath;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // Keep stale cache if present.
    if (fs.existsSync(filePath)) {
      return publicPath;
    }
    return null;
  }
}

function accountStatusFromTelegramAcc(acc, bot) {
  if (acc?.skipped) return "skipped";
  if (acc?.already) return "already";
  if (acc?.ok === true) return "success";
  if (acc?.ok === false) return "failed";
  if (bot?.status === "skipped") return "skipped";
  if (bot?.status === "success" || bot?.ok === true) return "success";
  if (bot?.ok === false || bot?.status === "failed" || bot?.status === "error") return "failed";
  return "unknown";
}

function aggregateProjectStatus(statuses) {
  if (!statuses.length) return "unknown";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.every((s) => s === "success" || s === "already")) {
    return statuses.every((s) => s === "already") ? "already" : "success";
  }
  if (statuses.every((s) => s === "skipped")) return "skipped";
  if (statuses.some((s) => s === "skipped") && !statuses.some((s) => s === "failed")) {
    // mixed success + skip → treat as success with skip note
    if (statuses.some((s) => s === "success" || s === "already")) return "success";
    return "skipped";
  }
  if (statuses.some((s) => s === "pending")) return "pending";
  return "unknown";
}

function mapTelegramResultsToSummaryItems(results) {
  const items = [];
  const bots = results && typeof results === "object" ? results.bots || {} : {};
  const updatedAt = results?.updatedAt || "";
  // Honor per-bot targetPhones from form so removed phones disappear from summary.
  const form = readEmbykeeperForm();
  const targetByBot = new Map();
  for (const tpl of form.botTemplates || []) {
    const key = String(tpl.botUsername || "").replace(/^@/, "");
    const phones = Array.isArray(tpl.targetPhones)
      ? tpl.targetPhones.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    targetByBot.set(key, phones);
  }
  // Only list bots still configured in form (deleted bot tasks stay gone).
  const configuredBots = new Set(targetByBot.keys());

  for (const [botKey, bot] of Object.entries(bots)) {
    if (!bot || typeof bot !== "object") continue;
    const botUsername = String(bot.botUsername || botKey || "").trim().replace(/^@/, "");
    if (configuredBots.size && !configuredBots.has(botUsername)) {
      continue;
    }
    const botName = String(bot.name || botUsername || botKey).trim();
    let accounts = Array.isArray(bot.accounts) ? bot.accounts : [];
    const allowed = targetByBot.get(botUsername) || [];
    if (allowed.length) {
      accounts = accounts.filter((a) => allowed.includes(String(a?.phone || "").trim()));
    }

    if (!accounts.length) {
      // Bot still configured but no account rows after filter — skip empty project.
      if (allowed.length) continue;
      const status = accountStatusFromTelegramAcc(null, bot);
      items.push({
        id: `tg:${botUsername || botKey}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        accountName: botUsername ? `@${botUsername}` : botName,
        botName,
        botUsername,
        status,
        ok: status === "success" || status === "already",
        message: String(bot.message || "").trim(),
        checkedAt: bot.checkedAt || updatedAt || "",
        pointsDelta: null,
        balance: null,
        currency: "",
        streak: null,
        leftDays: null,
        todaySigned: status === "success" || status === "already",
        notes: "",
        phone: ""
      });
      continue;
    }

    for (const acc of accounts) {
      const status = accountStatusFromTelegramAcc(acc, bot);
      const phone = String(acc?.phone || "").trim();
      items.push({
        id: `tg:${botUsername || botKey}:${phone || "default"}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        accountName: phone || (botUsername ? `@${botUsername}` : botName),
        botName,
        botUsername,
        status,
        ok: status === "success" || status === "already",
        message: String(acc?.message || bot.message || "").trim(),
        checkedAt: acc?.checkedAt || bot.checkedAt || updatedAt || "",
        pointsDelta: null,
        balance: null,
        currency: "",
        streak: null,
        leftDays: null,
        todaySigned: status === "success" || status === "already",
        notes: "",
        phone
      });
    }
  }

  return items;
}

/**
 * Merge same check-in project across accounts:
 * - website: one project per provider (GLaDOS / EmbyMB / …)
 * - telegram: one project per botUsername (accounts nested)
 */
async function buildSummaryProjects(websiteItems, telegramItems, req) {
  const projects = [];
  const base = publicBaseFromRequest(req);

  // Website: group by provider + site icon (favicon/logo)
  const webByProvider = new Map();
  for (const item of websiteItems) {
    const key = item.provider || "unknown";
    if (!webByProvider.has(key)) webByProvider.set(key, []);
    webByProvider.get(key).push(item);
  }

  // Prefer real baseUrl from stored accounts (icons come from the site itself).
  const baseUrlByProvider = new Map();
  for (const account of readAccounts()) {
    const p = String(account.provider || "glados").trim().toLowerCase() || "glados";
    const bu = String(account.baseUrl || "").trim();
    if (bu && !baseUrlByProvider.has(p)) {
      baseUrlByProvider.set(p, bu);
    }
  }

  for (const [provider, accounts] of webByProvider.entries()) {
    const statuses = accounts.map((a) => a.status);
    const status = aggregateProjectStatus(statuses);
    const counts = emptyStatusCounts();
    for (const s of statuses) {
      const k = counts[s] === undefined ? "unknown" : s;
      counts[k] += 1;
    }
    let checkedAt = "";
    for (const a of accounts) {
      if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt)) checkedAt = a.checkedAt;
    }
    const healthy = counts.success + counts.already;
    const siteBase = baseUrlByProvider.get(provider) || PROVIDER_DEFAULT_BASE[provider] || "";
    const iconPath = await ensureSiteIcon(provider, siteBase);
    const avatarURL = iconPath ? `${base}${iconPath}` : null;
    projects.push({
      id: `web:${provider}`,
      kind: "website",
      provider,
      providerLabel: providerLabel(provider),
      title: providerLabel(provider),
      subtitle: `${accounts.length} 个账号`,
      botUsername: null,
      botName: null,
      avatarURL,
      status,
      ok: status === "success" || status === "already",
      message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败`,
      checkedAt,
      accountCount: accounts.length,
      counts: {
        total: accounts.length,
        ...counts,
        healthy
      },
      accounts
    });
  }

  // Telegram: group by botUsername
  const tgByBot = new Map();
  for (const item of telegramItems) {
    const key = String(item.botUsername || item.id || "unknown").replace(/^@/, "");
    if (!tgByBot.has(key)) tgByBot.set(key, []);
    tgByBot.get(key).push(item);
  }

  // Fetch avatars with limited concurrency
  const botKeys = Array.from(tgByBot.keys());
  const avatarMap = new Map();
  const chunk = 4;
  for (let i = 0; i < botKeys.length; i += chunk) {
    const slice = botKeys.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map(async (username) => {
        const pathOnly = await ensureBotAvatar(username);
        return [username, pathOnly];
      })
    );
    for (const [username, pathOnly] of results) {
      avatarMap.set(username, pathOnly ? `${base}${pathOnly}` : null);
    }
  }

  for (const [botUsername, accounts] of tgByBot.entries()) {
    const botName = accounts[0]?.botName || botUsername;
    const statuses = accounts.map((a) => a.status);
    const status = aggregateProjectStatus(statuses);
    const counts = emptyStatusCounts();
    for (const s of statuses) {
      const k = counts[s] === undefined ? "unknown" : s;
      counts[k] += 1;
    }
    let checkedAt = "";
    for (const a of accounts) {
      if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt)) checkedAt = a.checkedAt;
    }
    const healthy = counts.success + counts.already;
    // Normalize nested account display names to phone / short label
    const nested = accounts.map((a) => ({
      ...a,
      accountName: a.phone || a.accountName || "账号"
    }));
    projects.push({
      id: `tg:${botUsername}`,
      kind: "telegram_bot",
      provider: "telegram_bot",
      providerLabel: providerLabel("telegram_bot"),
      title: botName,
      subtitle: botUsername ? `@${botUsername}` : providerLabel("telegram_bot"),
      botUsername,
      botName,
      avatarURL: avatarMap.get(botUsername) || null,
      status,
      ok: status === "success" || status === "already",
      message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败 · ${counts.skipped} 跳过`,
      checkedAt,
      accountCount: accounts.length,
      counts: {
        total: accounts.length,
        ...counts,
        healthy
      },
      accounts: nested
    });
  }

  return projects;
}

async function buildMobileSummary(req) {
  const websiteItems = readAccounts().map((account) =>
    mapWebsiteAccountToSummaryItem(toPublicAccount(account))
  );
  const telegramResults = readTelegramCheckinResults();
  const telegramItems = mapTelegramResultsToSummaryItems(telegramResults);
  const items = [...websiteItems, ...telegramItems];
  const projects = await buildSummaryProjects(websiteItems, telegramItems, req);

  // Also stamp avatarURL onto flat telegram items for clients that still use items[]
  const avatarByBot = new Map(
    projects
      .filter((p) => p.kind === "telegram_bot")
      .map((p) => [p.botUsername, p.avatarURL])
  );
  for (const item of items) {
    if (item.kind === "telegram_bot" && item.botUsername) {
      item.avatarURL = avatarByBot.get(item.botUsername) || null;
    } else {
      item.avatarURL = null;
    }
  }

  const counts = emptyStatusCounts();
  for (const item of items) {
    const key = counts[item.status] === undefined ? "unknown" : item.status;
    counts[key] += 1;
  }

  // Provider summary from projects (merged)
  const providerMap = new Map();
  for (const project of projects) {
    const key = project.provider || "unknown";
    if (!providerMap.has(key)) {
      providerMap.set(key, {
        key,
        label: project.providerLabel || providerLabel(key),
        counts: emptyStatusCounts(),
        itemCount: 0,
        projectCount: 0,
        lastCheckedAt: ""
      });
    }
    const group = providerMap.get(key);
    group.projectCount += 1;
    group.itemCount += project.accountCount || project.accounts?.length || 0;
    for (const [sk, sv] of Object.entries(project.counts || {})) {
      if (group.counts[sk] !== undefined && typeof sv === "number") {
        group.counts[sk] += sv;
      }
    }
    if (project.checkedAt && (!group.lastCheckedAt || project.checkedAt > group.lastCheckedAt)) {
      group.lastCheckedAt = project.checkedAt;
    }
  }

  let embykeeperStatus = null;
  try {
    embykeeperStatus = getEmbykeeperStatus();
  } catch {
    embykeeperStatus = null;
  }

  return {
    ok: true,
    generatedAt: formatDateTime(),
    source: "glados-checkin-web",
    auth: {
      appTokenConfigured: Boolean(APP_API_TOKEN)
    },
    counts: {
      total: items.length,
      projectTotal: projects.length,
      ...counts,
      healthy: counts.success + counts.already
    },
    providers: Array.from(providerMap.values()),
    /** Merged check-in projects (preferred for mobile UI). */
    projects,
    /** Flat account-level items (compat). */
    items,
    telegram: {
      updatedAt: telegramResults?.updatedAt || null,
      botCount: telegramResults?.bots ? Object.keys(telegramResults.bots).length : 0
    },
    embykeeper: embykeeperStatus
      ? {
          installed: Boolean(embykeeperStatus.installed),
          configPresent: Boolean(embykeeperStatus.configExists || embykeeperStatus.configPresent),
          sessionFiles: Array.isArray(embykeeperStatus.sessionFiles)
            ? embykeeperStatus.sessionFiles.length
            : Number(embykeeperStatus.sessionFiles) || 0,
          sessionStringCount: Number(embykeeperStatus.sessionStringCount) || 0
        }
      : null
  };
}

async function gladosApiRequest(account, method, routePath, payload, userAgent) {
  const baseUrl = normalizeBaseUrl(account.baseUrl);
  const host = new URL(baseUrl).hostname;
  const url = new URL(`/api/${routePath.replace(/^\/+/, "")}`, `${baseUrl}/`);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: account.cookie,
    Origin: baseUrl,
    Referer: `${baseUrl}/console/checkin`,
    "User-Agent": userAgent || account.userAgent || gladosUserAgent(account.loginDevice)
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

async function embymbLogin(account) {
  maybeAllowInsecureTls(account);

  const baseUrl = normalizeBaseUrl(account.baseUrl, DEFAULT_EMBYMB_BASE_URL);
  const loginUrl = new URL("/api/v1/auth/login", `${baseUrl}/`);
  const useEmail = String(account.username || "").includes("@");
  const credentials = useEmail
    ? { email: account.username, username: "", password: account.password }
    : { username: account.username, password: account.password };
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Origin: baseUrl,
      Referer: `${baseUrl}/login`
    },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { success: false, message: raw.slice(0, 180) };
  }

  if (!response.ok || data?.success !== true) {
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

async function embymbApiRequest(session, method, routePath, payload) {
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
    data = { success: false, message: raw.slice(0, 180) };
  }

  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }

  return data;
}

async function embymbSigninMe(session) {
  return await embymbApiRequest(session, "GET", "/api/v1/signin/me");
}

async function embymbSigninConfig(session) {
  return await embymbApiRequest(session, "GET", "/api/v1/signin/config");
}

function isEmbymbAlreadySigned(payload, infoPayload) {
  const message = String(payload?.message || "");
  return Boolean(infoPayload?.data?.today_signed) || payload?.success === true && (
    message.includes("已签到") ||
    message.includes("已经签到") ||
    message.includes("今日已签到") ||
    message.toLowerCase().includes("already")
  );
}

function summarizeEmbymbStatusPayload(infoPayload, configPayload) {
  if (infoPayload?.success === true) {
    const data = infoPayload?.data || {};
    const config = configPayload?.data || {};
    const todaySigned = Boolean(data.today_signed);
    const currentPoints = Number(data.current_points ?? 0);
    const currentStreak = Number(data.current_streak ?? 0);
    const longestStreak = Number(data.longest_streak ?? 0);
    const dailyMin = Number(config.daily_min ?? data.daily_min ?? 0);
    const dailyMax = Number(config.daily_max ?? data.daily_max ?? 0);
    const currency = data.currency_name || config.currency_name || "积分";

    return {
      ok: true,
      code: 0,
      state: "active",
      message: todaySigned ? "今日已签到" : "可签到",
      leftDays: null,
      vip: null,
      level: null,
      plan: currency,
      currency,
      points: currentPoints,
      currentStreak,
      longestStreak,
      todaySigned,
      lastSignInDate: data.last_signin_date || "",
      totalPoints: Number(data.total_points ?? 0),
      dailyMin,
      dailyMax,
      bonusTable: Array.isArray(config.bonus_table) ? config.bonus_table : [],
      raw: cloneData({ infoPayload, configPayload })
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: infoPayload?.message || "签到状态获取失败",
    leftDays: null,
    vip: null,
    level: null,
    plan: "EmbyMB",
    currency: infoPayload?.data?.currency_name || configPayload?.data?.currency_name || "积分",
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

function summarizeEmbymbCheckinPayload(payload, infoPayload) {
  const data = payload?.data || {};
  const message = String(payload?.message || "");
  const currentPoints = Number(data.current_points ?? infoPayload?.data?.current_points ?? 0);
  const dailyPoints = Number(data.daily_points ?? data.bonus_points ?? 0);
  const currency = data.currency_name || infoPayload?.data?.currency_name || "积分";
  const lastSignInDate = data.last_signin_date || infoPayload?.data?.last_signin_date || "";
  const already = Boolean(data.created === false) || isEmbymbAlreadySigned(payload, infoPayload);

  if (payload?.success === true) {
    return {
      ok: true,
      already,
      code: 0,
      message: message || (already ? "今天已经签到过了" : "签到成功"),
      points: dailyPoints,
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

function reconcileEmbymbCheckinWithStatus(checkin, status) {
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

function splitZhousanwanHttpMessage(httpMessage) {
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

function extractZhousanwanSetCookies(headerText) {
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

function beijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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
  const { headerText, body } = splitZhousanwanHttpMessage(httpMessage);
  const setCookies = extractZhousanwanSetCookies(headerText);
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

async function zhousanwanLogin(account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl, DEFAULT_ZHOUSANWAN_BASE_URL);
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

function zhousanwanLedgerItems(walletPayload) {
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

function latestZhousanwanCheckin(walletPayload) {
  return zhousanwanLedgerItems(walletPayload).find((item) => isZhousanwanCheckinEntry(item)) || null;
}

function findZhousanwanCheckinOnDate(walletPayload, date = beijingDateString()) {
  return (
    zhousanwanLedgerItems(walletPayload).find(
      (item) => isZhousanwanCheckinEntry(item) && String(item?.reference_id || "") === date
    ) || null
  );
}

function summarizeZhousanwanStatusPayload(payload) {
  if (payload?.ok) {
    const wallet = payload?.data?.wallet || {};
    const latestCheckin = latestZhousanwanCheckin(payload);
    const todayCheckin = findZhousanwanCheckinOnDate(payload);
    return {
      ok: true,
      code: 0,
      state: "active",
      message: todayCheckin
        ? "今日已签到"
        : latestCheckin
          ? "状态正常，最近有签到记录"
          : "状态正常",
      leftDays: null,
      vip: null,
      level: null,
      plan: "周三晚",
      points: Number(wallet.balance_minor ?? 0),
      balance: formatMinorAmount(wallet.balance_minor),
      currency: wallet.currency || "TOKEN",
      lastCheckinDate: latestCheckin?.reference_id || "",
      todaySigned: Boolean(todayCheckin),
      todayCheckinDate: todayCheckin?.reference_id || "",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: payload?.error?.message || payload?.message || "钱包状态获取失败",
    points: null,
    balance: null,
    currency: "TOKEN",
    todaySigned: false,
    raw: cloneData(payload)
  };
}

function summarizeZhousanwanCheckinPayload(payload) {
  const message = String(payload?.error?.message || payload?.message || "");
  if (payload?.ok) {
    const data = payload.data || {};
    const entry = data.entry || {};
    const wallet = data.wallet || {};
    const idempotent = Boolean(data.idempotent);
    return {
      ok: true,
      already: idempotent,
      code: 0,
      message: idempotent ? "今天已经签到过了" : "签到成功",
      points: Number(entry.amount_minor ?? data.checkin?.reward_minor ?? 0),
      balance: Number(wallet.balance_minor ?? entry.balance_after_minor ?? 0),
      balanceText: formatMinorAmount(wallet.balance_minor ?? entry.balance_after_minor),
      currency: wallet.currency || data.checkin?.currency || "TOKEN",
      checkinDate: data.checkin?.checkin_date || entry.reference_id || "",
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
      balance: null,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: payload?.error?.code || null,
    message: message || "签到失败",
    points: 0,
    balance: null,
    raw: cloneData(payload)
  };
}

function summarizeZhousanwanAlreadyFromStatus(status) {
  return {
    ok: true,
    already: true,
    code: 0,
    message: "今天已经签到过了",
    points: 0,
    balance: status?.points ?? null,
    balanceText: status?.balance ?? null,
    currency: status?.currency || "TOKEN",
    checkinDate: status?.todayCheckinDate || status?.lastCheckinDate || beijingDateString(),
    raw: status?.raw || null,
    fromWallet: true
  };
}

function reconcileZhousanwanCheckinWithStatus(checkin, status) {
  if (checkin?.ok || !status?.todaySigned) {
    return checkin;
  }
  return {
    ...summarizeZhousanwanAlreadyFromStatus(status),
    reconciledAfterStatusRefresh: true,
    previousMessage: checkin?.message || ""
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

  if (code === 4 && payload?.reason === "device-mismatch") {
    return {
      ok: false,
      already: false,
      code,
      reason: payload.reason,
      loginDevice: payload.loginDevice || null,
      currentDevice: payload.currentDevice || null,
      message: message || "签到设备与登录设备不一致",
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
  if ((account.provider || "glados") === "embymb") {
    const now = formatDateTime();
    let status;

    try {
      const session = await embymbLogin(account);
      const infoPayload = await embymbSigninMe(session);
      const configPayload = await embymbSigninConfig(session);
      status = summarizeEmbymbStatusPayload(infoPayload, configPayload);
    } catch (error) {
      status = {
        ok: false,
        code: null,
        state: "error",
        message: error.message,
        leftDays: null,
        vip: null,
        level: null,
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

  if ((account.provider || "glados") === "zhousanwan") {
    const now = formatDateTime();
    let status;

    try {
      const session = await zhousanwanLogin(account);
      const payload = await zhousanwanApiRequest(session, "GET", "/api/v1/finance/wallet/me?limit=35");
      status = summarizeZhousanwanStatusPayload(payload);
    } catch (error) {
      status = {
        ok: false,
        code: null,
        state: "error",
        message: error.message,
        points: null,
        balance: null,
        currency: "TOKEN",
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
  if ((account.provider || "glados") === "embymb") {
    const now = formatDateTime();
    let nextAccount = { ...account };
    let checkin;

    try {
      const session = await embymbLogin(account);
      const infoPayload = await embymbSigninMe(session);

      if (Boolean(infoPayload?.data?.today_signed)) {
        checkin = summarizeEmbymbCheckinPayload({
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
      } else {
        const payload = await embymbApiRequest(session, "POST", "/api/v1/signin");
        checkin = summarizeEmbymbCheckinPayload(payload, infoPayload);
      }
    } catch (error) {
      checkin = {
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

    nextAccount = {
      ...nextAccount,
      lastCheckinAt: now,
      lastCheckin: checkin,
      updatedAt: now
    };

    nextAccount = (await refreshAccountStatus(nextAccount)).account;
    checkin = reconcileEmbymbCheckinWithStatus(nextAccount.lastCheckin, nextAccount.lastStatus);
    nextAccount.lastCheckin = checkin;

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

  if ((account.provider || "glados") === "zhousanwan") {
    const now = formatDateTime();
    let nextAccount = { ...account };
    let checkin;
    const maxAttempts = Math.max(1, Number(process.env.CHECKIN_MAX_ATTEMPTS || 5));
    const retryDelayMs = Math.max(0, Number(process.env.CHECKIN_RETRY_DELAY_MS || 8000));
    const attempts = [];

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      try {
        const session = await zhousanwanLogin(account);
        const walletPayload = await zhousanwanApiRequest(
          session,
          "GET",
          "/api/v1/finance/wallet/me?limit=35"
        );
        const status = summarizeZhousanwanStatusPayload(walletPayload);
        if (status.todaySigned) {
          checkin = summarizeZhousanwanAlreadyFromStatus(status);
        } else {
          // Frontend posts an empty JSON object body to /api/v1/finance/checkins.
          const payload = await zhousanwanApiRequest(
            session,
            "POST",
            "/api/v1/finance/checkins",
            {}
          );
          checkin = summarizeZhousanwanCheckinPayload(payload);
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

      attempts.push({
        attempt: attemptNumber,
        ok: checkin.ok,
        already: checkin.already,
        points: checkin.points,
        balance: checkin.balance,
        message: checkin.message,
        at: formatDateTime()
      });

      if (checkin.ok || attemptNumber >= maxAttempts || !isTransientZhousanwanError(checkin.message)) {
        break;
      }

      if (retryDelayMs > 0) {
        await sleep(Math.min(60000, retryDelayMs * attemptNumber));
      }
    }

    nextAccount = {
      ...nextAccount,
      lastCheckinAt: now,
      lastCheckin: checkin,
      updatedAt: now
    };

    nextAccount = (await refreshAccountStatus(nextAccount)).account;
    checkin = reconcileZhousanwanCheckinWithStatus(checkin, nextAccount.lastStatus);
    checkin = {
      ...checkin,
      attemptCount: attempts.length,
      maxAttempts,
      retryCount: Math.max(0, attempts.length - 1),
      attempts
    };
    nextAccount.lastCheckin = checkin;

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
    let userAgent = account.userAgent || gladosUserAgent(account.loginDevice);
    let payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host }, userAgent);

    if (Number(payload?.code) === 4 && payload?.reason === "device-mismatch") {
      const matchedAgent = gladosUserAgent(payload.loginDevice);
      if (matchedAgent !== userAgent) {
        payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host }, matchedAgent);
        userAgent = matchedAgent;
      }
    }

    checkin = summarizeCheckinPayload(payload);
    checkin.userAgent = userAgent;
    if (payload?.loginDevice) {
      checkin.loginDevice = payload.loginDevice;
    }
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
  if (checkin.userAgent) {
    nextAccount.userAgent = checkin.userAgent;
  }
  if (checkin.loginDevice) {
    nextAccount.loginDevice = checkin.loginDevice;
  }

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

  // Mobile / PersonalToolbox read API — Bearer APP_API_TOKEN or web session cookie.
  if (pathname.startsWith("/api/v1/")) {
    if (!requireAppOrSessionAuth(req, res)) {
      return;
    }

    if (method === "GET" && pathname === "/api/v1/summary") {
      sendJson(res, 200, await buildMobileSummary(req));
      return;
    }

    if (method === "GET" && pathname === "/api/v1/health") {
      sendJson(res, 200, {
        ok: true,
        now: formatDateTime(),
        appTokenConfigured: Boolean(APP_API_TOKEN),
        auth: isAppTokenAuthorized(req) ? "token" : "session"
      });
      return;
    }

    // --- Mobile account management (website check-in tasks) ---
    if (method === "GET" && pathname === "/api/v1/accounts") {
      sendJson(res, 200, {
        accounts: readAccounts().map((a) => toMobileAccountDetail(a))
      });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/accounts") {
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
      sendJson(res, 201, { account: toMobileAccountDetail(nextAccount) });
      return;
    }

    const v1AccountMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (v1AccountMatch) {
      const accountId = decodeURIComponent(v1AccountMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }

      if (method === "GET") {
        sendJson(res, 200, { account: toMobileAccountDetail(account) });
        return;
      }

      if (method === "PUT") {
        const body = await readRequestBody(req);
        const nextAccount = normalizeAccountMobileUpdate(body, account);
        const error = validateAccount(nextAccount);
        if (error) {
          sendJson(res, 400, { error });
          return;
        }
        const nextAccounts = accounts.map((item) => (item.id === accountId ? nextAccount : item));
        writeAccounts(nextAccounts);
        sendJson(res, 200, { account: toMobileAccountDetail(nextAccount) });
        return;
      }

      if (method === "DELETE") {
        const nextAccounts = accounts.filter((item) => item.id !== accountId);
        writeAccounts(nextAccounts);
        sendJson(res, 200, { ok: true, deletedId: accountId });
        return;
      }
    }

    // --- Mobile Telegram bot / phone management (embykeeper form) ---
    if (method === "GET" && pathname === "/api/v1/telegram/bots") {
      sendJson(res, 200, listMobileTelegramBots());
      return;
    }

    const v1TgBotMatch = pathname.match(/^\/api\/v1\/telegram\/bots\/([^/]+)$/);
    if (v1TgBotMatch) {
      const botUsername = decodeURIComponent(v1TgBotMatch[1]).replace(/^@/, "");
      if (method === "PUT") {
        const body = await readRequestBody(req);
        const result = updateMobileTelegramBot(botUsername, body || {});
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      if (method === "DELETE") {
        const result = deleteMobileTelegramBot(botUsername);
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
    }

    const v1TgPhoneMatch = pathname.match(/^\/api\/v1\/telegram\/phones\/([^/]+)$/);
    if (v1TgPhoneMatch && method === "DELETE") {
      const phone = decodeURIComponent(v1TgPhoneMatch[1]);
      const result = deleteMobileTelegramPhone(phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    // DELETE one phone from one bot only (multi-account project).
    const v1TgBotPhoneMatch = pathname.match(
      /^\/api\/v1\/telegram\/bots\/([^/]+)\/phones\/([^/]+)$/
    );
    if (v1TgBotPhoneMatch && method === "DELETE") {
      const botUsername = decodeURIComponent(v1TgBotPhoneMatch[1]).replace(/^@/, "");
      const phone = decodeURIComponent(v1TgBotPhoneMatch[2]);
      const result = removePhoneFromTelegramBot(botUsername, phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    // Mobile: run check-in for one website account.
    const v1CheckinMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/checkin$/);
    if (v1CheckinMatch && method === "POST") {
      const accountId = decodeURIComponent(v1CheckinMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      const processed = await runAccountCheckin(account);
      const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
      writeAccounts(nextAccounts);
      sendJson(res, 200, {
        ok: Boolean(processed.summary?.checkin?.ok ?? processed.account?.lastCheckin?.ok),
        result: processed.summary,
        account: toMobileAccountDetail(processed.account)
      });
      return;
    }

    // Mobile: run check-in for all accounts of a website provider (e.g. glados).
    if (method === "POST" && pathname === "/api/v1/checkin/run") {
      const body = await readRequestBody(req);
      const provider = String(body?.provider || "").trim().toLowerCase();
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      let accounts = readAccounts();
      let selected = accounts;
      if (ids.length) {
        const set = new Set(ids);
        selected = accounts.filter((a) => set.has(a.id));
      } else if (provider) {
        selected = accounts.filter((a) => (a.provider || "glados") === provider);
      }
      if (!selected.length) {
        sendJson(res, 400, { error: "没有可签到的账号" });
        return;
      }
      const results = [];
      for (const account of selected) {
        const processed = await runAccountCheckin(account);
        accounts = accounts.map((item) => (item.id === account.id ? processed.account : item));
        results.push({
          id: account.id,
          name: account.name,
          ok: Boolean(processed.account?.lastCheckin?.ok),
          message: processed.account?.lastCheckin?.message || processed.summary?.checkin?.message || ""
        });
      }
      writeAccounts(accounts);
      sendJson(res, 200, {
        ok: results.every((r) => r.ok),
        results,
        successCount: results.filter((r) => r.ok).length,
        total: results.length
      });
      return;
    }

    sendJson(res, 404, { error: "Not Found", path: pathname });
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
      form: readEmbykeeperForm(),
      checkinResults: readTelegramCheckinResults()
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
      status: getEmbykeeperStatus(),
      checkinResults: readTelegramCheckinResults()
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

    // Public icons for mobile clients (AsyncImage) — TG bot photos + website favicons/logos.
    if (
      (url.pathname.startsWith("/bot-avatars/") || url.pathname.startsWith("/site-icons/")) &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      serveStatic(req, res, url);
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器内部错误" });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    ensureDataFiles();
    console.log(`Checkin API listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  runAccountCheckin,
  refreshAccountStatus,
  readAccounts,
  writeAccounts
};
