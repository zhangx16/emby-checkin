const state = {
  projects: [],
  loadErrors: [],
  expandedIds: new Set()
};

const projectGrid = document.querySelector("#projectGrid");
const searchInput = document.querySelector("#searchInput");
const providerFilter = document.querySelector("#providerFilter");
const statusFilter = document.querySelector("#statusFilter");
const visibleText = document.querySelector("#visibleText");
const refreshViewBtn = document.querySelector("#refreshViewBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const toast = document.querySelector("#toast");
const lastActionText = document.querySelector("#lastActionText");
const statTotal = document.querySelector("#statTotal");
const statHealthy = document.querySelector("#statHealthy");
const statAttention = document.querySelector("#statAttention");
const statChecked = document.querySelector("#statChecked");

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1800);
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value) {
  if (!value) return "未记录";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function normalizeProvider(value) {
  const provider = String(value || "glados").trim().toLowerCase();
  return ["embypulse", "embymb", "zhousanwan", "dian115"].includes(provider) ? provider : "glados";
}

function providerLabel(value) {
  const provider = normalizeProvider(value);
  if (provider === "embypulse") return "EmbyPulse";
  if (provider === "embymb") return "EmbyMB";
  if (provider === "zhousanwan") return "周三晚";
  if (provider === "dian115") return "癫影";
  return "GLaDOS";
}

function statusMeta(status) {
  if (!status) {
    return { key: "unchecked", label: "未查询", className: "status-unchecked" };
  }
  const key = status.state || (status.ok ? "active" : "error");
  const mapping = {
    active: { label: "正常", className: "status-active" },
    expired: { label: "过期", className: "status-expired" },
    unpaid: { label: "待激活", className: "status-unpaid" },
    unauthorized: { label: "失效", className: "status-unauthorized" },
    unchecked: { label: "未查询", className: "status-unchecked" },
    error: { label: "异常", className: "status-error" }
  };
  return { key, ...(mapping[key] || mapping.error) };
}

function isCheckedToday(project) {
  if (!project.lastCheckinAt || !project.checkinOk) {
    return false;
  }
  const parsed = new Date(project.lastCheckinAt);
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

function siteMetric(account) {
  const provider = normalizeProvider(account.provider);
  const status = account.lastStatus || {};
  if (provider === "zhousanwan") {
    return `${status.balance ?? "--"} ${status.currency || "TOKEN"}`;
  }
  if (provider === "dian115") {
    return `${status.points ?? "--"} ${status.currency || "积分"}`;
  }
  if (provider === "embymb") {
    return `${status.points ?? "--"} ${status.currency || "积分"}`;
  }
  if (provider === "embypulse") {
    return `${status.points ?? "--"} 积分`;
  }
  return `${formatInteger(status.leftDays)} 天`;
}

function formatInteger(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return String(Math.round(number));
}

function siteSubtitle(account) {
  const status = account.lastStatus || {};
  const provider = normalizeProvider(account.provider);
  if (provider === "zhousanwan") {
    return status.lastCheckinDate ? `最近签到 ${status.lastCheckinDate}` : "最近签到 --";
  }
  if (provider === "dian115") {
    return status.todaySigned ? "今日已签到" : (status.nickname ? `用户 ${status.nickname}` : "今日未签到");
  }
  if (provider === "embymb") {
    const streak = status.currentStreak ?? "--";
    return status.lastSignInDate
      ? `最近签到 ${status.lastSignInDate} · 连签 ${streak} 天`
      : `连签 ${streak} 天`;
  }
  if (provider === "embypulse") {
    return status.expireDate ? `到期 ${status.expireDate}` : "到期 --";
  }
  return status.plan || "套餐 --";
}

function siteCheckinText(account) {
  const checkin = account.lastCheckin;
  if (!checkin) return "尚未记录签到";
  if (checkin.ok && checkin.already) return `今日已签 · ${checkin.message || "已签到"}`;
  if (checkin.ok) return `成功 · ${checkin.message || "签到成功"}`;
  return `失败 · ${checkin.message || "未知错误"}`;
}

function accountToProject(account) {
  const provider = normalizeProvider(account.provider);
  const status = statusMeta(account.lastStatus);
  return {
    id: `site:${account.id}`,
    kind: "site",
    provider,
    typeLabel: providerLabel(provider),
    title: account.name || providerLabel(provider),
    target: account.baseUrl || "",
    auth: account.authPreview || "凭据已保存",
    notes: account.notes || "",
    metric: siteMetric(account),
    subtitle: siteSubtitle(account),
    statusKey: status.key,
    statusLabel: status.label,
    statusClass: status.className,
    statusMessage: account.lastStatus?.message || "未获取状态",
    checkinText: siteCheckinText(account),
    updatedAt: account.updatedAt || account.lastCheckinAt || account.lastStatusAt || "",
    lastCheckinAt: account.lastCheckinAt || "",
    checkinOk: Boolean(account.lastCheckin?.ok)
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

function botResultText(result) {
  if (!result) return "尚未记录签到";
  if (result.status === "skipped") return `跳过 · ${result.message || "已跳过"}`;
  if (result.ok) return result.message ? `成功 · ${result.message}` : "成功 · 签到完成";
  return `失败 · ${result.message || "未知错误"}`;
}

function botStatusMeta(result) {
  if (!result) {
    return { key: "unchecked", label: "未测试", className: "status-unchecked" };
  }
  if (result.status === "skipped") {
    return { key: "active", label: "已跳过", className: "status-unchecked" };
  }
  return result.ok
    ? { key: "active", label: "成功", className: "status-active" }
    : { key: "error", label: "失败", className: "status-error" };
}

function formatBotAccounts(result) {
  const accounts = Array.isArray(result?.accounts) ? result.accounts : [];
  if (!accounts.length) return "未记录";
  return accounts.map((item) => {
    const label = item.skipped ? "跳过" : item.ok ? (item.already ? "已签" : "成功") : "失败";
    return `${item.phone || "未知账号"}: ${label}${item.message ? ` · ${item.message}` : ""}`;
  }).join("\n");
}

function botToProject(bot, index, resultMap = {}) {
  const username = String(bot?.botUsername || bot?.bot_username || "").trim();
  const name = String(bot?.name || username || `Bot ${index + 1}`).trim();
  const commands = normalizeStringArray(bot?.commands || bot?.bot_checkin_cmd, ["/checkin"]);
  const targetPhones = normalizeStringArray(bot?.targetPhones || bot?.target_phones || bot?.bot_target_phones, []);
  const waitResponse = bot?.waitResponse !== false;
  const result = resultMap[username] || resultMap[username.replace(/^@/, "")] || null;
  const status = botStatusMeta(result);
  return {
    id: `telegram:${username || index}`,
    kind: "telegram",
    provider: "telegram",
    typeLabel: "Telegram Bot",
    title: name,
    target: username ? `@${username}` : "未填写 Bot 用户名",
    auth: targetPhones.length ? `限定 ${targetPhones.length} 个 TG 账号` : "全部 TG 账号",
    notes: commands.join(" / "),
    metric: waitResponse ? "等待回执" : "不等回执",
    subtitle: `间隔 ${Number(bot?.sendInterval ?? bot?.bot_send_interval ?? 3) || 3}s`,
    statusKey: status.key,
    statusLabel: status.label,
    statusClass: status.className,
    statusMessage: formatBotAccounts(result),
    checkinText: botResultText(result),
    updatedAt: result?.checkedAt || "",
    lastCheckinAt: result?.checkedAt || "",
    checkinOk: Boolean(result?.ok),
    detailLabel: "账号明细"
  };
}

function filteredProjects() {
  const query = searchInput.value.trim().toLowerCase();
  const provider = providerFilter.value;
  const status = statusFilter.value;

  return state.projects.filter((project) => {
    const matchesProvider =
      !provider ||
      project.provider === provider ||
      project.kind === provider;
    const matchesStatus =
      !status ||
      project.statusKey === status ||
      (status === "error" && !["active", "unchecked"].includes(project.statusKey));
    const haystack = [
      project.typeLabel,
      project.title,
      project.target,
      project.auth,
      project.notes,
      project.metric,
      project.subtitle,
      project.statusMessage,
      project.checkinText
    ].join(" ").toLowerCase();
    return matchesProvider && matchesStatus && (!query || haystack.includes(query));
  });
}

function renderStats() {
  statTotal.textContent = String(state.projects.length);
  statHealthy.textContent = String(state.projects.filter((item) => item.statusKey === "active").length);
  statAttention.textContent = String(
    state.projects.filter((item) => item.statusKey && !["active", "unchecked"].includes(item.statusKey)).length
  );
  statChecked.textContent = String(state.projects.filter(isCheckedToday).length);
}

function renderProjects() {
  const projects = filteredProjects();
  visibleText.textContent = `显示 ${projects.length} / ${state.projects.length} 项`;
  renderStats();

  if (!projects.length) {
    projectGrid.innerHTML = `<div class="empty-state">没有匹配的签到项目。</div>`;
    return;
  }

  projectGrid.innerHTML = projects.map((project) => {
    const isExpanded = state.expandedIds.has(project.id);
    const updatedText = project.updatedAt ? `更新 ${formatTime(project.updatedAt)}` : "由后台任务更新";
    const hasResult = project.checkinText !== "尚未记录签到";
    const resultClass = project.checkinOk
      ? "result-ok"
      : hasResult
        ? "result-error"
        : "muted-text";

    return `
      <article class="project-card ${project.kind === "telegram" ? "bot-card" : ""} ${isExpanded ? "is-expanded" : ""}" data-project-id="${escapeHtml(project.id)}">
        <div class="project-summary" data-action="toggle-project" role="button" tabindex="0" aria-expanded="${isExpanded ? "true" : "false"}">
          <div class="project-identity">
            <div class="project-topline">
              <span class="provider-badge">${escapeHtml(project.typeLabel)}</span>
              <span class="status-pill ${project.statusClass}">${escapeHtml(project.statusLabel)}</span>
            </div>
            <h2>${escapeHtml(project.title)}</h2>
            <div class="project-target">${escapeHtml(project.target)}</div>
          </div>
          <div class="project-metric-block">
            <div class="project-metric">${escapeHtml(project.metric)}</div>
            <div class="muted-text">${escapeHtml(project.subtitle)}</div>
          </div>
          <div class="project-status-block">
            <strong class="${resultClass}">${escapeHtml(project.checkinText)}</strong>
            <span>${escapeHtml(updatedText)}</span>
          </div>
          <span class="project-toggle">${isExpanded ? "收起" : "详情"}</span>
        </div>
        <div class="project-details" ${isExpanded ? "" : "hidden"}>
          <div class="detail-grid">
            <div class="detail-item">
              <span>凭据范围</span>
              <strong>${escapeHtml(project.auth)}</strong>
            </div>
            <div class="detail-item">
              <span>备注/命令</span>
              <strong>${escapeHtml(project.notes || "无备注")}</strong>
            </div>
            <div class="detail-item">
              <span>${escapeHtml(project.detailLabel || "状态说明")}</span>
              <strong>${escapeHtml(project.statusMessage)}</strong>
            </div>
            <div class="detail-item">
              <span>最后签到</span>
              <strong>${escapeHtml(project.lastCheckinAt ? formatTime(project.lastCheckinAt) : "未记录")}</strong>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

async function loadAccountProjects() {
  const data = await request("/api/accounts");
  return (data.accounts || []).map(accountToProject);
}

async function loadBotProjects() {
  const data = await request("/api/embykeeper/form");
  const bots = Array.isArray(data.form?.botTemplates) ? data.form.botTemplates : [];
  const resultMap = data.checkinResults?.bots || {};
  return bots.map((bot, index) => botToProject(bot, index, resultMap));
}

async function refreshView() {
  state.loadErrors = [];
  const [accountResult, botResult] = await Promise.allSettled([
    loadAccountProjects(),
    loadBotProjects()
  ]);

  const projects = [];
  if (accountResult.status === "fulfilled") {
    projects.push(...accountResult.value);
  } else {
    state.loadErrors.push(`账号项目加载失败: ${accountResult.reason.message}`);
  }

  if (botResult.status === "fulfilled") {
    projects.push(...botResult.value);
  } else {
    state.loadErrors.push(`Telegram 项目加载失败: ${botResult.reason.message}`);
  }

  state.projects = projects;
  const currentIds = new Set(projects.map((project) => project.id));
  state.expandedIds = new Set([...state.expandedIds].filter((id) => currentIds.has(id)));
  renderProjects();
  const suffix = state.loadErrors.length ? `，${state.loadErrors.join("；")}` : "";
  lastActionText.textContent = `已刷新 ${projects.length} 个项目 · ${formatTime(new Date().toISOString())}${suffix}`;
  if (state.loadErrors.length) {
    showToast(state.loadErrors[0]);
  }
}

searchInput.addEventListener("input", renderProjects);
providerFilter.addEventListener("change", renderProjects);
statusFilter.addEventListener("change", renderProjects);

function toggleProject(trigger) {
  const card = trigger.closest("[data-project-id]");
  const projectId = card?.dataset.projectId;
  if (!projectId) return;

  if (state.expandedIds.has(projectId)) {
    state.expandedIds.delete(projectId);
  } else {
    state.expandedIds.add(projectId);
  }
  renderProjects();
}

projectGrid.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action='toggle-project']");
  if (!trigger) return;
  toggleProject(trigger);
});

projectGrid.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;

  const trigger = event.target.closest("[data-action='toggle-project']");
  if (!trigger) return;
  event.preventDefault();
  toggleProject(trigger);
});

refreshViewBtn.addEventListener("click", async () => {
  refreshViewBtn.disabled = true;
  try {
    await refreshView();
  } catch (error) {
    showToast(error.message);
  } finally {
    refreshViewBtn.disabled = false;
  }
});

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

refreshView().catch((error) => {
  showToast(error.message);
});
