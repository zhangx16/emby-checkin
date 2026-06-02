const state = {
  accounts: [],
  selectedIds: new Set(),
  logs: []
};

const tableBody = document.querySelector("#tableBody");
const searchInput = document.querySelector("#searchInput");
const providerFilter = document.querySelector("#providerFilter");
const statusFilter = document.querySelector("#statusFilter");
const selectAll = document.querySelector("#selectAll");
const selectedText = document.querySelector("#selectedText");
const addAccountBtn = document.querySelector("#addAccountBtn");
const refreshAllBtn = document.querySelector("#refreshAllBtn");
const checkinAllBtn = document.querySelector("#checkinAllBtn");
const refreshSelectedBtn = document.querySelector("#refreshSelectedBtn");
const checkinSelectedBtn = document.querySelector("#checkinSelectedBtn");
const deleteSelectedBtn = document.querySelector("#deleteSelectedBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const importBtn = document.querySelector("#importBtn");
const exportBtn = document.querySelector("#exportBtn");
const importInput = document.querySelector("#importInput");
const toast = document.querySelector("#toast");
const logList = document.querySelector("#logList");
const serviceEndpoint = document.querySelector("#serviceEndpoint");
const lastActionText = document.querySelector("#lastActionText");
const statTotal = document.querySelector("#statTotal");
const statHealthy = document.querySelector("#statHealthy");
const statAttention = document.querySelector("#statAttention");
const statChecked = document.querySelector("#statChecked");
const telegramAccountsList = document.querySelector("#telegramAccountsList");
const botTemplatesList = document.querySelector("#botTemplatesList");
const globalCheckinerFields = document.querySelector("#globalCheckinerFields");
const addTelegramAccountBtn = document.querySelector("#addTelegramAccountBtn");
const addBotTemplateBtn = document.querySelector("#addBotTemplateBtn");
const saveEmbykeeperFormBtn = document.querySelector("#saveEmbykeeperFormBtn");
const collapseToggles = document.querySelectorAll(".collapse-toggle");
const embykeeperFormStateText = document.querySelector("#embykeeperFormState");
const embykeeperStatusPill = document.querySelector("#embykeeperStatusPill");
const embykeeperBinaryPath = document.querySelector("#embykeeperBinaryPath");
const embykeeperConfigPath = document.querySelector("#embykeeperConfigPath");
const embykeeperRuntimePath = document.querySelector("#embykeeperRuntimePath");
const embykeeperSessionFiles = document.querySelector("#embykeeperSessionFiles");
const embykeeperFirstRunHint = document.querySelector("#embykeeperFirstRunHint");
const embykeeperConfigState = document.querySelector("#embykeeperConfigState");
const embykeeperConfigEditor = document.querySelector("#embykeeperConfigEditor");
const embykeeperOutput = document.querySelector("#embykeeperOutput");
const reloadEmbykeeperBtn = document.querySelector("#reloadEmbykeeperBtn");
const runEmbykeeperBtn = document.querySelector("#runEmbykeeperBtn");
const saveEmbykeeperConfigBtn = document.querySelector("#saveEmbykeeperConfigBtn");
const editorDialog = document.querySelector("#editorDialog");
const accountForm = document.querySelector("#accountForm");
const dialogTitle = document.querySelector("#dialogTitle");
const closeDialogBtn = document.querySelector("#closeDialogBtn");
const cancelDialogBtn = document.querySelector("#cancelDialogBtn");
const accountIdField = document.querySelector("#accountId");
const providerField = document.querySelector("#providerField");
const nameField = document.querySelector("#nameField");
const baseUrlField = document.querySelector("#baseUrlField");
const notesField = document.querySelector("#notesField");
const cookieField = document.querySelector("#cookieField");
const cookieAuthGroup = document.querySelector("#cookieAuthGroup");
const embyAuthGroup = document.querySelector("#embyAuthGroup");
const usernameField = document.querySelector("#usernameField");
const passwordField = document.querySelector("#passwordField");
const insecureTlsField = document.querySelector("#insecureTlsField");

let toastTimer = null;
let embykeeperConfigDirty = false;
let embykeeperFormDirty = false;
let embykeeperForm = null;

serviceEndpoint.textContent = window.location.origin;

function normalizeProvider(value) {
  const provider = String(value || "glados").trim().toLowerCase();
  return ["embypulse", "incudal"].includes(provider) ? provider : "glados";
}

function providerLabel(value) {
  const provider = normalizeProvider(value);
  if (provider === "embypulse") return "EmbyPulse";
  if (provider === "incudal") return "Incudal";
  return "GLaDOS";
}

function providerDefaultBaseUrl(value) {
  const provider = normalizeProvider(value);
  if (provider === "embypulse") return "https://embypulse.example.com";
  if (provider === "incudal") return "https://incudal.com";
  return "https://glados.network";
}

function updateProviderFields() {
  const provider = normalizeProvider(providerField.value);
  const isEmbyPulse = provider === "embypulse";

  cookieAuthGroup.classList.toggle("hidden", isEmbyPulse);
  embyAuthGroup.classList.toggle("hidden", !isEmbyPulse);

  cookieField.required = !isEmbyPulse;
  usernameField.required = isEmbyPulse;
  passwordField.required = isEmbyPulse;

  if (!baseUrlField.value.trim()) {
    baseUrlField.value = providerDefaultBaseUrl(provider);
  }

  baseUrlField.placeholder = providerDefaultBaseUrl(provider);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1600);
}

function setStatusPill(element, label, className) {
  if (!element) return;
  element.textContent = label;
  element.className = `status-pill ${className}`;
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
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  return fallback.slice();
}

function normalizeEmbykeeperForm(value) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultEmbykeeperForm();
  return {
    telegramAccounts: (Array.isArray(source.telegramAccounts) ? source.telegramAccounts : defaults.telegramAccounts).map((item) => ({
      phone: String(item?.phone || "").trim(),
      apiId: String(item?.apiId || item?.api_id || "").trim(),
      apiHash: String(item?.apiHash || item?.api_hash || "").trim(),
      session: String(item?.session || "").trim(),
      enabled: item?.enabled !== false,
      checkiner: item?.checkiner !== false
    })),
    botTemplates: (Array.isArray(source.botTemplates) ? source.botTemplates : defaults.botTemplates).map((item) => ({
      botUsername: String(item?.botUsername || item?.bot_username || "").trim(),
      name: String(item?.name || "").trim(),
      commands: normalizeStringArray(item?.commands || item?.bot_checkin_cmd, ["/checkin"]),
      successKeywords: normalizeStringArray(item?.successKeywords || item?.bot_success_keywords, defaults.botTemplates[0].successKeywords),
      checkedKeywords: normalizeStringArray(item?.checkedKeywords || item?.bot_checked_keywords, defaults.botTemplates[0].checkedKeywords),
      failKeywords: normalizeStringArray(item?.failKeywords || item?.bot_fail_keywords, defaults.botTemplates[0].failKeywords),
      textIgnore: normalizeStringArray(item?.textIgnore || item?.bot_text_ignore, []),
      targetPhones: normalizeStringArray(item?.targetPhones || item?.target_phones || item?.bot_target_phones, []),
      sendInterval: Number(item?.sendInterval ?? item?.bot_send_interval ?? 3) || 3,
      useCaptcha: item?.useCaptcha !== false,
      isChat: Boolean(item?.isChat),
      waitResponse: item?.waitResponse !== false
    })),
    globalCheckiner: {
      timeout: Number(source?.globalCheckiner?.timeout ?? defaults.globalCheckiner.timeout) || defaults.globalCheckiner.timeout,
      retries: Number(source?.globalCheckiner?.retries ?? defaults.globalCheckiner.retries) || defaults.globalCheckiner.retries,
      concurrency: Number(source?.globalCheckiner?.concurrency ?? defaults.globalCheckiner.concurrency) || defaults.globalCheckiner.concurrency,
      randomStart: Number(source?.globalCheckiner?.randomStart ?? defaults.globalCheckiner.randomStart) || defaults.globalCheckiner.randomStart,
      intervalDays: String(source?.globalCheckiner?.intervalDays ?? defaults.globalCheckiner.intervalDays).trim(),
      timeRange: String(source?.globalCheckiner?.timeRange ?? defaults.globalCheckiner.timeRange).trim()
    }
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "请求失败");
  }

  return data;
}

function formatTime(value) {
  if (!value) {
    return "未记录";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function getStatusBadge(status) {
  if (!status) {
    return { label: "未查询", className: "status-unchecked" };
  }

  const mapping = {
    active: { label: "正常", className: "status-active" },
    expired: { label: "已过期", className: "status-expired" },
    unpaid: { label: "待激活", className: "status-unpaid" },
    unauthorized: { label: "Cookie 失效", className: "status-unauthorized" },
    error: { label: "请求异常", className: "status-error" }
  };

  return mapping[status.state] || { label: status.message || "未知", className: "status-error" };
}

function getCheckinText(checkin) {
  if (!checkin) {
    return { text: "尚未签到", className: "muted-text" };
  }

  if (checkin.ok) {
    return {
      text: checkin.already ? `已签过: ${checkin.message}` : `成功: ${checkin.message}`,
      className: "result-ok"
    };
  }

  return { text: `失败: ${checkin.message}`, className: "result-error" };
}

function getBenefitSummary(account) {
  const provider = normalizeProvider(account.provider);
  const status = account.lastStatus || {};

  if (provider === "embypulse") {
    return {
      headline: `${status.points ?? "--"} 积分`,
      line1: status.expireDate ? `到期: ${status.expireDate}` : "到期: --",
      line2: status.message || "未获取状态"
    };
  }

  if (provider === "incudal") {
    return {
      headline: `${status.points ?? "--"} 资源点`,
      line1: `配额: 主机 ${status.quota?.hostUsed ?? "--"}/${status.quota?.hostLimit ?? "--"} · 套餐 ${status.quota?.packageUsed ?? "--"}/${status.quota?.packageLimit ?? "--"}`,
      line2: `资源池: CPU ${status.pool?.cpu ?? "--"} · RAM ${status.pool?.memory ?? "--"} · Disk ${status.pool?.disk ?? "--"}`
    };
  }

  return {
    headline: `${status.leftDays ?? "--"} 天`,
    line1: status.plan || "未知套餐",
    line2: `VIP: ${status.vip ?? "--"} · Level: ${status.level ?? "--"}`
  };
}

function isCheckedToday(account) {
  if (!account.lastCheckinAt || !account.lastCheckin?.ok) {
    return false;
  }

  const parsed = new Date(account.lastCheckinAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const now = new Date();
  return (
    parsed.getUTCFullYear() === now.getUTCFullYear() &&
    parsed.getUTCMonth() === now.getUTCMonth() &&
    parsed.getUTCDate() === now.getUTCDate()
  );
}

function filteredAccounts() {
  const query = searchInput.value.trim().toLowerCase();
  const provider = providerFilter.value;
  const filter = statusFilter.value;

  return state.accounts.filter((account) => {
    const accountProvider = normalizeProvider(account.provider);
    const statusState = account.lastStatus?.state || "unchecked";
    const matchesProvider = !provider || accountProvider === provider;
    const matchesStatus = !filter || statusState === filter;
    const haystack = [
      account.name,
      account.providerLabel,
      account.baseUrl,
      account.notes,
      account.authPreview
    ]
      .join(" ")
      .toLowerCase();

    return matchesProvider && matchesStatus && (!query || haystack.includes(query));
  });
}

function renderStats() {
  statTotal.textContent = String(state.accounts.length);
  statHealthy.textContent = String(state.accounts.filter((item) => item.lastStatus?.state === "active").length);
  statAttention.textContent = String(
    state.accounts.filter((item) => {
      const stateValue = item.lastStatus?.state;
      return stateValue && stateValue !== "active";
    }).length
  );
  statChecked.textContent = String(state.accounts.filter(isCheckedToday).length);
}

function renderLogs() {
  if (!state.logs.length) {
    logList.innerHTML = `<div class="log-empty">这里会显示最近一次批量刷新和批量签到的结果。</div>`;
    return;
  }

  logList.innerHTML = state.logs
    .map(
      (entry) => `
        <div class="log-item">
          <strong>${entry.title}</strong>
          <div class="muted-text">${entry.body}</div>
          <div class="muted-text">${entry.time}</div>
        </div>
      `
    )
    .join("");
}

function pushLog(title, body) {
  const entry = {
    title,
    body,
    time: formatTime(new Date().toISOString())
  };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 14);
  lastActionText.textContent = `${entry.title} · ${entry.body}`;
  renderLogs();
}

function renderEmbykeeperStatus(status) {
  if (!status) {
    setStatusPill(embykeeperStatusPill, "未知", "status-unchecked");
    return;
  }

  if (!status.installed) {
    setStatusPill(embykeeperStatusPill, "未安装", "status-error");
  } else if (Array.isArray(status.sessionFiles) && status.sessionFiles.length > 0) {
    setStatusPill(embykeeperStatusPill, "已就绪", "status-active");
  } else {
    setStatusPill(embykeeperStatusPill, "待登录", "status-unpaid");
  }

  embykeeperBinaryPath.textContent = status.binaryPath || "-";
  embykeeperConfigPath.textContent = status.configPath || "-";
  embykeeperRuntimePath.textContent = status.runtimeDir || "-";
  embykeeperSessionFiles.textContent = status.sessionFiles?.length
    ? status.sessionFiles.join(", ")
    : "无";
  embykeeperFirstRunHint.textContent = status.firstRunHint || "-";
}

function setEmbykeeperFormState(text) {
  if (!embykeeperFormStateText) return;
  embykeeperFormStateText.textContent = text || "";
}

function renderTelegramAccountsForm() {
  telegramAccountsList.innerHTML = embykeeperForm.telegramAccounts.map((account, index) => `
    <div class="dynamic-item" data-kind="telegram" data-index="${index}">
      <div class="dynamic-item-head">
        <div class="dynamic-item-title">Telegram 账号 ${index + 1}</div>
        <button class="danger-btn compact-btn" type="button" data-action="remove-telegram" data-index="${index}">删除</button>
      </div>
      <div class="field-grid">
        <label>手机号
          <input type="text" data-field="phone" data-index="${index}" value="${escapeHtml(account.phone)}" placeholder="+8613800000000">
        </label>
        <label>API ID
          <input type="text" data-field="apiId" data-index="${index}" value="${escapeHtml(account.apiId)}" placeholder="可选">
        </label>
        <label>API Hash
          <input type="text" data-field="apiHash" data-index="${index}" value="${escapeHtml(account.apiHash)}" placeholder="可选">
        </label>
        <label>Session
          <textarea data-field="session" data-index="${index}" placeholder="可选，通常首次登录后自动生成">${escapeHtml(account.session)}</textarea>
        </label>
      </div>
      <div class="checkbox-row">
        <label class="checkbox-chip"><input type="checkbox" data-field="enabled" data-index="${index}" ${account.enabled ? "checked" : ""}>启用</label>
        <label class="checkbox-chip"><input type="checkbox" data-field="checkiner" data-index="${index}" ${account.checkiner ? "checked" : ""}>启用签到</label>
      </div>
    </div>
  `).join("");
}

function renderBotTemplatesForm() {
  botTemplatesList.innerHTML = embykeeperForm.botTemplates.map((bot, index) => `
    <div class="dynamic-item" data-kind="bot" data-index="${index}">
      <div class="dynamic-item-head">
        <div class="dynamic-item-title">Bot 模板 ${index + 1}</div>
        <button class="danger-btn compact-btn" type="button" data-action="remove-bot" data-index="${index}">删除</button>
      </div>
      <div class="field-grid">
        <label>Bot 用户名
          <input type="text" data-field="botUsername" data-index="${index}" value="${escapeHtml(bot.botUsername)}" placeholder="例如 my_checkin_bot">
        </label>
        <label>显示名称
          <input type="text" data-field="name" data-index="${index}" value="${escapeHtml(bot.name)}" placeholder="例如 机场签到机器人">
        </label>
        <label>签到命令
          <textarea data-field="commands" data-index="${index}" placeholder="/checkin&#10;/start">${escapeHtml(bot.commands.join("\n"))}</textarea>
        </label>
        <label>成功关键词
          <textarea data-field="successKeywords" data-index="${index}" placeholder="签到成功">${escapeHtml(bot.successKeywords.join("\n"))}</textarea>
        </label>
        <label>已签到关键词
          <textarea data-field="checkedKeywords" data-index="${index}" placeholder="今日已签到">${escapeHtml(bot.checkedKeywords.join("\n"))}</textarea>
        </label>
        <label>失败关键词
          <textarea data-field="failKeywords" data-index="${index}" placeholder="失败">${escapeHtml(bot.failKeywords.join("\n"))}</textarea>
        </label>
        <label>忽略关键词
          <textarea data-field="textIgnore" data-index="${index}" placeholder="广告&#10;欢迎">${escapeHtml(bot.textIgnore.join("\n"))}</textarea>
        </label>
        <label>限定 TG 账号
          <textarea data-field="targetPhones" data-index="${index}" placeholder="+8618130611329&#10;留空表示全部账号">${escapeHtml((bot.targetPhones || []).join("\n"))}</textarea>
        </label>
        <label>发送间隔秒数
          <input type="number" min="1" step="1" data-field="sendInterval" data-index="${index}" value="${escapeHtml(bot.sendInterval)}">
        </label>
      </div>
      <div class="checkbox-row">
        <label class="checkbox-chip"><input type="checkbox" data-field="useCaptcha" data-index="${index}" ${bot.useCaptcha ? "checked" : ""}>启用验证码识别</label>
        <label class="checkbox-chip"><input type="checkbox" data-field="isChat" data-index="${index}" ${bot.isChat ? "checked" : ""}>群组模式</label>
        <label class="checkbox-chip"><input type="checkbox" data-field="waitResponse" data-index="${index}" ${bot.waitResponse ? "checked" : ""}>等待回复确认</label>
      </div>
    </div>
  `).join("");
}

function renderGlobalCheckinerForm() {
  const config = embykeeperForm.globalCheckiner;
  globalCheckinerFields.innerHTML = `
    <label>签到时间范围
      <input type="text" data-global-field="timeRange" value="${escapeHtml(config.timeRange)}" placeholder="<11:00AM,11:00PM>">
    </label>
    <label>签到间隔天数
      <input type="text" data-global-field="intervalDays" value="${escapeHtml(config.intervalDays)}" placeholder="1">
    </label>
    <label>超时秒数
      <input type="number" min="10" step="1" data-global-field="timeout" value="${escapeHtml(config.timeout)}">
    </label>
    <label>重试次数
      <input type="number" min="1" step="1" data-global-field="retries" value="${escapeHtml(config.retries)}">
    </label>
    <label>并发数
      <input type="number" min="1" step="1" data-global-field="concurrency" value="${escapeHtml(config.concurrency)}">
    </label>
    <label>随机启动分钟
      <input type="number" min="0" step="1" data-global-field="randomStart" value="${escapeHtml(config.randomStart)}">
    </label>
  `;
}

function renderEmbykeeperForm() {
  if (!embykeeperForm) {
    embykeeperForm = normalizeEmbykeeperForm(defaultEmbykeeperForm());
  }
  renderTelegramAccountsForm();
  renderBotTemplatesForm();
  renderGlobalCheckinerForm();
}

async function loadEmbykeeperPanel() {
  const data = await request("/api/embykeeper/config");
  renderEmbykeeperStatus(data.status);
  embykeeperConfigEditor.value = data.config || "";
  embykeeperConfigState.textContent = "已加载";
  embykeeperConfigDirty = false;
  const formData = await request("/api/embykeeper/form");
  embykeeperForm = normalizeEmbykeeperForm(formData.form);
  renderEmbykeeperForm();
  embykeeperFormDirty = false;
  setEmbykeeperFormState("已加载");
}

async function saveEmbykeeperConfig() {
  const data = await request("/api/embykeeper/config", {
    method: "PUT",
    body: JSON.stringify({ config: embykeeperConfigEditor.value })
  });
  renderEmbykeeperStatus(data.status);
  embykeeperConfigState.textContent = "已保存";
  embykeeperConfigDirty = false;
  showToast("emby-keeper 配置已保存");
}

async function saveEmbykeeperForm() {
  const data = await request("/api/embykeeper/form", {
    method: "PUT",
    body: JSON.stringify({ form: embykeeperForm })
  });
  renderEmbykeeperStatus(data.status);
  embykeeperConfigEditor.value = data.config || "";
  embykeeperConfigState.textContent = "已同步";
  embykeeperConfigDirty = false;
  embykeeperFormDirty = false;
  setEmbykeeperFormState("已保存");
  showToast("emby-keeper 表单配置已保存");
}

async function runEmbykeeperOnce() {
  const response = await fetch("/api/embykeeper/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  renderEmbykeeperStatus(data.status);
  embykeeperOutput.value = (data.output || data.error || "无输出").trim();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "emby-keeper 运行失败");
  }

  showToast("emby-keeper 执行完成");
}

function updateSelectionInfo() {
  const visibleIds = filteredAccounts().map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
  selectAll.checked = allVisibleSelected;
  selectedText.textContent = `已选 ${state.selectedIds.size} 项`;
}

function renderTable() {
  const items = filteredAccounts();
  renderStats();
  updateSelectionInfo();

  if (!items.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted-text">当前没有匹配的数据。你可以先新增账号，或者调整搜索与筛选条件。</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = items
    .map((account) => {
      const statusBadge = getStatusBadge(account.lastStatus);
      const checkinText = getCheckinText(account.lastCheckin);
      const selected = state.selectedIds.has(account.id) ? "checked" : "";
      const benefit = getBenefitSummary(account);

      return `
        <tr data-id="${account.id}">
          <td class="checkbox-col">
            <input type="checkbox" data-action="select-row" ${selected}>
          </td>
          <td>
            <div class="provider-badge">${escapeHtml(account.providerLabel || providerLabel(account.provider))}</div>
            <div class="account-name">${escapeHtml(account.name)}</div>
            <div class="account-meta">${escapeHtml(account.authPreview || "未保存凭据")}</div>
            <div class="account-meta">${escapeHtml(account.notes || "无备注")}</div>
          </td>
          <td>
            <div class="site-url">${escapeHtml(account.baseUrl)}</div>
            <div class="site-meta">创建时间: ${escapeHtml(formatTime(account.createdAt))}</div>
          </td>
          <td>
            <div class="result-stack">
              <span class="status-pill ${statusBadge.className}">${escapeHtml(statusBadge.label)}</span>
              <span class="muted-text">${escapeHtml(account.lastStatus?.message || "未获取状态")}</span>
            </div>
          </td>
          <td>
            <div class="plan-stack">
              <strong>${escapeHtml(benefit.headline)}</strong>
              <span class="muted-text">${escapeHtml(benefit.line1)}</span>
              <span class="muted-text">${escapeHtml(benefit.line2)}</span>
            </div>
          </td>
          <td>
            <div class="result-stack">
              <span class="${checkinText.className}">${escapeHtml(checkinText.text)}</span>
              <span class="muted-text">${escapeHtml(formatTime(account.lastCheckinAt))}</span>
            </div>
          </td>
          <td>
            <div class="time-stack">
              <span>状态: ${escapeHtml(formatTime(account.lastStatusAt))}</span>
              <span>记录: ${escapeHtml(formatTime(account.updatedAt))}</span>
            </div>
          </td>
          <td>
            <div class="row-actions">
              <button type="button" class="tiny-btn" data-action="refresh">刷新</button>
              <button type="button" class="tiny-btn" data-action="checkin">签到</button>
              <button type="button" class="tiny-btn" data-action="edit">编辑</button>
              <button type="button" class="tiny-btn danger" data-action="delete">删除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadAccounts() {
  const data = await request("/api/accounts");
  state.accounts = data.accounts || [];
  const existingIds = new Set(state.accounts.map((item) => item.id));
  state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => existingIds.has(id)));
  renderTable();
}

function selectedIdsOrAll() {
  return Array.from(state.selectedIds);
}

function openEditor(account = null) {
  accountForm.reset();
  providerField.value = normalizeProvider(account?.provider || "glados");
  accountIdField.value = account?.id || "";
  nameField.value = account?.name || "";
  baseUrlField.value = account?.baseUrl || providerDefaultBaseUrl(providerField.value);
  notesField.value = account?.notes || "";
  cookieField.value = account?.cookie || "";
  usernameField.value = account?.username || "";
  passwordField.value = account?.password || "";
  insecureTlsField.checked = Boolean(account?.insecureTls);
  dialogTitle.textContent = account ? "编辑账号" : "新增账号";
  updateProviderFields();
  editorDialog.showModal();
}

async function editAccount(id) {
  const data = await request(`/api/accounts/${id}`);
  openEditor(data.account);
}

function closeEditor() {
  editorDialog.close();
}

async function saveAccount(event) {
  event.preventDefault();
  const payload = {
    provider: normalizeProvider(providerField.value),
    name: nameField.value.trim(),
    baseUrl: baseUrlField.value.trim(),
    notes: notesField.value.trim(),
    cookie: cookieField.value.trim(),
    username: usernameField.value.trim(),
    password: passwordField.value,
    insecureTls: insecureTlsField.checked
  };

  const id = accountIdField.value.trim();
  const url = id ? `/api/accounts/${id}` : "/api/accounts";
  const method = id ? "PUT" : "POST";

  await request(url, {
    method,
    body: JSON.stringify(payload)
  });

  showToast(id ? "账号已更新" : "账号已创建");
  closeEditor();
  await loadAccounts();
}

async function deleteAccount(id) {
  const target = state.accounts.find((item) => item.id === id);
  if (!target || !window.confirm(`确定删除账号「${target.name}」吗？`)) {
    return;
  }

  await request(`/api/accounts/${id}`, { method: "DELETE" });
  state.selectedIds.delete(id);
  showToast("账号已删除");
  await loadAccounts();
}

async function refreshSingle(id) {
  const data = await request(`/api/accounts/${id}/status/refresh`, { method: "POST" });
  const result = data.result;
  pushLog(`刷新状态 · ${result.name}`, result.status?.message || "已完成");
  showToast(`已刷新 ${result.name}`);
  await loadAccounts();
}

async function checkinSingle(id) {
  const data = await request(`/api/accounts/${id}/checkin`, { method: "POST" });
  const result = data.result;
  pushLog(`单账号签到 · ${result.name}`, result.checkin?.message || "已完成");
  showToast(`已执行 ${result.name} 的签到`);
  await loadAccounts();
}

function summarizeBatchResults(results, type) {
  if (!results.length) {
    return "没有命中任何账号";
  }

  if (type === "status") {
    const ok = results.filter((item) => item.status?.ok).length;
    return `共 ${results.length} 个账号，正常 ${ok} 个，异常 ${results.length - ok} 个`;
  }

  const ok = results.filter((item) => item.checkin?.ok).length;
  const already = results.filter((item) => item.checkin?.already).length;
  return `共 ${results.length} 个账号，成功 ${ok - already} 个，已签过 ${already} 个，失败 ${results.length - ok} 个`;
}

async function refreshBatch(ids) {
  const data = await request("/api/status/refresh", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  pushLog("批量刷新状态", summarizeBatchResults(data.results || [], "status"));
  showToast("批量刷新已完成");
  await loadAccounts();
}

async function checkinBatch(ids) {
  const data = await request("/api/checkin/run", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  pushLog("批量签到", summarizeBatchResults(data.results || [], "checkin"));
  showToast("批量签到已完成");
  await loadAccounts();
}

async function handleImport(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : Array.isArray(parsed) ? parsed : [];

  if (!accounts.length) {
    throw new Error("导入文件里没有 accounts 数组");
  }

  await request("/api/accounts/import", {
    method: "POST",
    body: JSON.stringify({ accounts })
  });

  pushLog("导入账号", `已导入 ${accounts.length} 条记录`);
  showToast("导入完成");
  await loadAccounts();
}

function downloadExport() {
  window.open("/api/accounts/export", "_blank");
}

tableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const checkbox = event.target.closest('input[data-action="select-row"]');
  const row = event.target.closest("tr[data-id]");
  if (!row) {
    return;
  }

  const id = row.dataset.id;

  if (checkbox) {
    if (checkbox.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
    updateSelectionInfo();
    return;
  }

  if (!button) {
    return;
  }

  button.disabled = true;

  try {
    if (button.dataset.action === "refresh") {
      await refreshSingle(id);
    } else if (button.dataset.action === "checkin") {
      await checkinSingle(id);
    } else if (button.dataset.action === "edit") {
      await editAccount(id);
    } else if (button.dataset.action === "delete") {
      await deleteAccount(id);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

selectAll.addEventListener("change", () => {
  const items = filteredAccounts();
  if (selectAll.checked) {
    items.forEach((item) => state.selectedIds.add(item.id));
  } else {
    items.forEach((item) => state.selectedIds.delete(item.id));
  }
  renderTable();
});

searchInput.addEventListener("input", renderTable);
providerFilter.addEventListener("change", renderTable);
statusFilter.addEventListener("change", renderTable);
providerField.addEventListener("change", updateProviderFields);
embykeeperConfigEditor.addEventListener("input", () => {
  embykeeperConfigDirty = true;
  embykeeperConfigState.textContent = "未保存";
});
addTelegramAccountBtn.addEventListener("click", () => {
  embykeeperForm.telegramAccounts.push(defaultTelegramAccountForm());
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
  renderEmbykeeperForm();
});
addBotTemplateBtn.addEventListener("click", () => {
  embykeeperForm.botTemplates.push(defaultBotTemplateForm());
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
  renderEmbykeeperForm();
});
saveEmbykeeperFormBtn.addEventListener("click", async () => {
  try {
    await saveEmbykeeperForm();
  } catch (error) {
    showToast(error.message);
  }
});
reloadEmbykeeperBtn.addEventListener("click", async () => {
  try {
    await loadEmbykeeperPanel();
    showToast("emby-keeper 状态已刷新");
  } catch (error) {
    showToast(error.message);
  }
});
saveEmbykeeperConfigBtn.addEventListener("click", async () => {
  try {
    await saveEmbykeeperConfig();
  } catch (error) {
    showToast(error.message);
  }
});
runEmbykeeperBtn.addEventListener("click", async () => {
  runEmbykeeperBtn.disabled = true;
  try {
    if (embykeeperFormDirty) {
      await saveEmbykeeperForm();
    } else if (embykeeperConfigDirty) {
      await saveEmbykeeperConfig();
    }
    await runEmbykeeperOnce();
  } catch (error) {
    showToast(error.message);
  } finally {
    runEmbykeeperBtn.disabled = false;
  }
});
telegramAccountsList.addEventListener("input", (event) => {
  const target = event.target;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;
  const account = embykeeperForm.telegramAccounts[index];
  if (!account) return;
  account[target.dataset.field] = target.value;
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
});
telegramAccountsList.addEventListener("change", (event) => {
  const target = event.target;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;
  const account = embykeeperForm.telegramAccounts[index];
  if (!account) return;

  if (target.type === "checkbox") {
    account[target.dataset.field] = target.checked;
    embykeeperFormDirty = true;
    setEmbykeeperFormState("未保存");
    return;
  }

  if (target.dataset.action === "remove-telegram") {
    embykeeperForm.telegramAccounts.splice(index, 1);
    if (!embykeeperForm.telegramAccounts.length) {
      embykeeperForm.telegramAccounts.push(defaultTelegramAccountForm());
    }
    embykeeperFormDirty = true;
    setEmbykeeperFormState("未保存");
    renderEmbykeeperForm();
  }
});
telegramAccountsList.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="remove-telegram"]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;
  embykeeperForm.telegramAccounts.splice(index, 1);
  if (!embykeeperForm.telegramAccounts.length) {
    embykeeperForm.telegramAccounts.push(defaultTelegramAccountForm());
  }
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
  renderEmbykeeperForm();
});
botTemplatesList.addEventListener("input", (event) => {
  const target = event.target;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;
  const bot = embykeeperForm.botTemplates[index];
  if (!bot) return;
  const field = target.dataset.field;
  if (["commands", "successKeywords", "checkedKeywords", "failKeywords", "textIgnore", "targetPhones"].includes(field)) {
    bot[field] = normalizeStringArray(target.value);
  } else if (field === "sendInterval") {
    bot[field] = Number(target.value) || 1;
  } else {
    bot[field] = target.value;
  }
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
});
botTemplatesList.addEventListener("change", (event) => {
  const target = event.target;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;
  const bot = embykeeperForm.botTemplates[index];
  if (!bot) return;

  if (target.type === "checkbox") {
    bot[target.dataset.field] = target.checked;
    embykeeperFormDirty = true;
    setEmbykeeperFormState("未保存");
  }
});
botTemplatesList.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="remove-bot"]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;
  embykeeperForm.botTemplates.splice(index, 1);
  if (!embykeeperForm.botTemplates.length) {
    embykeeperForm.botTemplates.push(defaultBotTemplateForm());
  }
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
  renderEmbykeeperForm();
});
globalCheckinerFields.addEventListener("input", (event) => {
  const target = event.target;
  const field = target.dataset.globalField;
  if (!field) return;
  if (["timeout", "retries", "concurrency", "randomStart"].includes(field)) {
    embykeeperForm.globalCheckiner[field] = Number(target.value) || 0;
  } else {
    embykeeperForm.globalCheckiner[field] = target.value;
  }
  embykeeperFormDirty = true;
  setEmbykeeperFormState("未保存");
});
collapseToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const target = toggle.dataset.collapseTarget;
    const section = document.querySelector(`.form-section[data-collapse="${target}"]`);
    if (!section) return;
    section.classList.toggle("is-collapsed");
  });
});

addAccountBtn.addEventListener("click", () => openEditor());
closeDialogBtn.addEventListener("click", closeEditor);
cancelDialogBtn.addEventListener("click", closeEditor);
editorDialog.addEventListener("click", (event) => {
  const rect = editorDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (!inside) {
    closeEditor();
  }
});
accountForm.addEventListener("submit", async (event) => {
  try {
    await saveAccount(event);
  } catch (error) {
    showToast(error.message);
  }
});

refreshAllBtn.addEventListener("click", async () => {
  try {
    await refreshBatch([]);
  } catch (error) {
    showToast(error.message);
  }
});

checkinAllBtn.addEventListener("click", async () => {
  try {
    await checkinBatch([]);
  } catch (error) {
    showToast(error.message);
  }
});

refreshSelectedBtn.addEventListener("click", async () => {
  const ids = selectedIdsOrAll();
  if (!ids.length) {
    showToast("请先选择账号");
    return;
  }

  try {
    await refreshBatch(ids);
  } catch (error) {
    showToast(error.message);
  }
});

checkinSelectedBtn.addEventListener("click", async () => {
  const ids = selectedIdsOrAll();
  if (!ids.length) {
    showToast("请先选择账号");
    return;
  }

  try {
    await checkinBatch(ids);
  } catch (error) {
    showToast(error.message);
  }
});

deleteSelectedBtn.addEventListener("click", async () => {
  const ids = selectedIdsOrAll();
  if (!ids.length) {
    showToast("请先选择账号");
    return;
  }

  if (!window.confirm(`确定删除所选 ${ids.length} 个账号吗？`)) {
    return;
  }

  try {
    await request("/api/accounts/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    state.selectedIds.clear();
    pushLog("批量删除", `已删除 ${ids.length} 个账号`);
    showToast("已删除所选账号");
    await loadAccounts();
  } catch (error) {
    showToast(error.message);
  }
});

importBtn.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    await handleImport(file);
  } catch (error) {
    showToast(error.message);
  } finally {
    importInput.value = "";
  }
});

exportBtn.addEventListener("click", downloadExport);
logoutBtn.addEventListener("click", async () => {
  try {
    await request("/api/logout", { method: "POST" });
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
      return;
    }
  }
  window.location.href = "/login";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editorDialog.open) {
    closeEditor();
  }
});

loadAccounts().catch((error) => {
  showToast(error.message);
});
loadEmbykeeperPanel().catch((error) => {
  if (embykeeperOutput) {
    embykeeperOutput.value = error.message;
  }
});
