/* ============================================================
   Task Manager — Frontend SPA
   State persists in localStorage. Swap out the DB layer
   (DB.*) with fetch() calls when wiring to a backend.
   ============================================================ */

// ---------- STORAGE LAYER (mock backend) ----------
const DB = {
  KEY_USERS: "tm_users",
  KEY_SESSION: "tm_session",
  KEY_TASKS: "tm_tasks",

  getUsers() {
    return JSON.parse(localStorage.getItem(this.KEY_USERS) || "[]");
  },
  setUsers(u) {
    localStorage.setItem(this.KEY_USERS, JSON.stringify(u));
  },

  getSession() {
    return JSON.parse(localStorage.getItem(this.KEY_SESSION) || "null");
  },
  setSession(s) {
    localStorage.setItem(this.KEY_SESSION, JSON.stringify(s));
  },
  clearSession() {
    localStorage.removeItem(this.KEY_SESSION);
  },

  getTasks() {
    return JSON.parse(localStorage.getItem(this.KEY_TASKS) || "[]");
  },
  setTasks(t) {
    localStorage.setItem(this.KEY_TASKS, JSON.stringify(t));
  },

  tasksFor(userId) {
    return this.getTasks().filter((t) => t.userId === userId);
  },
};

// ---------- APP STATE ----------
const state = {
  user: null,
  view: "dashboard",
  editingId: null,
  filters: { q: "", status: "", priority: "" },
  reminderShown: false, // ensures reminder toast appears once per session
};

// ---------- UTILITIES ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function flash(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `flash flash-${type}`;
  el.textContent = msg;
  $("#flash-container").appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 0.4s, transform 0.4s";
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

// ---------- CONFIRM MODAL ----------
let confirmResolve = null;
function confirmDialog(title, msg) {
  $("#modal-title").textContent = title;
  $("#modal-msg").textContent = msg;
  $("#modal-overlay").style.display = "grid";
  return new Promise((res) => {
    confirmResolve = res;
  });
}
$("#modal-cancel").onclick = () => {
  $("#modal-overlay").style.display = "none";
  confirmResolve?.(false);
};
$("#modal-confirm").onclick = () => {
  $("#modal-overlay").style.display = "none";
  confirmResolve?.(true);
};

// ============================================================
// AUTH
// ============================================================
let authMode = "login"; // or 'register'

function setAuthMode(mode) {
  authMode = mode;
  $("#auth-title").textContent =
    mode === "login" ? "Welcome back" : "Create your account";
  $("#auth-sub").textContent =
    mode === "login"
      ? "Sign in to your workspace"
      : "Start organizing your work today";
  $("#auth-submit").textContent =
    mode === "login" ? "Sign in" : "Create account";
  $("#email-group").style.display = mode === "register" ? "block" : "none";
  $("#auth-email").required = mode === "register";
  $("#auth-toggle-text").textContent =
    mode === "login" ? "Don't have an account?" : "Already have an account?";
  $("#auth-toggle-link").textContent =
    mode === "login" ? "Create one" : "Sign in";
  $("#auth-error").classList.remove("show");
}

$("#auth-toggle-link").onclick = (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "register" : "login");
};

$("#auth-form").onsubmit = (e) => {
  e.preventDefault();
  const username = $("#auth-username").value.trim();
  const email = $("#auth-email").value.trim().toLowerCase();
  const password = $("#auth-password").value;

  const users = DB.getUsers();

  if (authMode === "register") {
    if (!email) return showAuthError("Email is required.");
    if (password.length < 6)
      return showAuthError("Password must be at least 6 characters.");
    if (users.find((u) => u.username.toLowerCase() === username.toLowerCase()))
      return showAuthError("Username already taken.");
    if (users.find((u) => u.email === email))
      return showAuthError("Email already registered.");

    const user = { id: uid(), username, email, password };
    users.push(user);
    DB.setUsers(users);
    DB.setSession({ userId: user.id });
    flash("Account created. Welcome!", "success");
    startApp(user);
  } else {
    const user = users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (!user || user.password !== password)
      return showAuthError("Invalid username or password.");
    DB.setSession({ userId: user.id });
    flash(`Welcome back, ${user.username}!`, "success");
    startApp(user);
  }
};

function showAuthError(msg) {
  const err = $("#auth-error");
  err.textContent = msg;
  err.classList.add("show");
}

// ============================================================
// APP START / LOGOUT
// ============================================================
function startApp(user) {
  state.user = user;
  state.reminderShown = false; // reset per login
  $("#auth-screen").style.display = "none";
  $("#app").style.display = "grid"; // sidebar grid layout
  $("#nav-username").textContent = user.username;

  const avatar = $("#user-avatar");
  if (avatar) avatar.textContent = (user.username[0] || "U").toUpperCase();

  $("#auth-form").reset();
  navigate("dashboard");

  // After dashboard renders, show bell state + reminder toast
  setTimeout(() => {
    refreshNotifications();
    showReminderToast();
  }, 300);
}

$("#logout-btn").onclick = () => {
  DB.clearSession();
  state.user = null;
  state.reminderShown = false;
  closeNotifPanel();
  $("#app").style.display = "none";
  $("#auth-screen").style.display = "grid";
  setAuthMode("login");
};

// ============================================================
// NAVIGATION
// ============================================================
function navigate(view) {
  state.view = view;

  $$(".view").forEach((v) => (v.style.display = "none"));
  const target = $(`#view-${view}`);
  if (target) target.style.display = "block";

  // Sidebar active state
  $$(".side-link").forEach((l) =>
    l.classList.toggle("active", l.dataset.nav === view),
  );

  // Topbar title
  const titles = {
    dashboard: "Dashboard",
    tasks: "My Tasks",
    new: state.editingId ? "Edit Task" : "New Task",
    reports: "Reports & Analytics",
  };
  const topbarTitle = $("#topbar-title");
  if (topbarTitle) topbarTitle.textContent = titles[view] || "";

  // Close mobile sidebar
  closeSidebar();
  closeNotifPanel();

  if (view === "dashboard") renderDashboard();
  if (view === "tasks") renderTasks();
  if (view === "reports") renderReports();
  if (view === "new") renderForm();

  refreshNotifications();
}

document.body.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    e.preventDefault();
    navigate(nav.dataset.nav);
  }
});

// ============================================================
// MOBILE SIDEBAR
// ============================================================
function closeSidebar() {
  $("#sidebar")?.classList.remove("open");
  $("#sidebar-overlay")?.classList.remove("show");
}
$("#nav-toggle").onclick = () => {
  $("#sidebar")?.classList.toggle("open");
  $("#sidebar-overlay")?.classList.toggle("show");
};
$("#sidebar-overlay")?.addEventListener("click", closeSidebar);

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const tasks = DB.tasksFor(state.user.id);
  const stats = computeStats(tasks);

  $("#dash-stats").innerHTML = `
    <div class="stat-card"><span class="stat-value">${stats.total}</span><span class="stat-label">Total</span></div>
    <div class="stat-card pending"><span class="stat-value">${stats.pending}</span><span class="stat-label">Pending</span></div>
    <div class="stat-card progress"><span class="stat-value">${stats.inProgress}</span><span class="stat-label">In Progress</span></div>
    <div class="stat-card done"><span class="stat-value">${stats.completed}</span><span class="stat-label">Completed</span></div>
    <div class="stat-card high"><span class="stat-value">${stats.highPriority}</span><span class="stat-label">High Priority</span></div>
    <div class="stat-card overdue"><span class="stat-value">${stats.overdue}</span><span class="stat-label">Overdue</span></div>
  `;

  const recent = [...tasks]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  $("#dash-recent").innerHTML = recent.length
    ? renderTaskTable(recent, false)
    : emptyState(
        "📋",
        "No tasks yet",
        "Get started by creating your first task.",
        "new",
        "Create Task",
      );
}

// ============================================================
// TASKS LIST
// ============================================================
["filter-search", "filter-status", "filter-priority"].forEach((id) => {
  const el = $(`#${id}`);
  if (!el) return;
  el.addEventListener("input", () => {
    state.filters.q = $("#filter-search").value.trim().toLowerCase();
    state.filters.status = $("#filter-status").value;
    state.filters.priority = $("#filter-priority").value;
    renderTasks();
  });
});
$("#filter-clear").onclick = () => {
  $("#filter-search").value = "";
  $("#filter-status").value = "";
  $("#filter-priority").value = "";
  state.filters = { q: "", status: "", priority: "" };
  renderTasks();
};

function renderTasks() {
  const { q, status, priority } = state.filters;
  let tasks = DB.tasksFor(state.user.id);

  if (q) tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (priority) tasks = tasks.filter((t) => t.priority === priority);

  tasks.sort((a, b) => {
    const aOver = isOverdue(a) ? 0 : 1;
    const bOver = isOverdue(b) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  $("#tasks-list").innerHTML = tasks.length
    ? renderTaskTable(tasks, true)
    : emptyState(
        "🔍",
        "No tasks found",
        "Try adjusting your filters or create a new task.",
        "new",
        "Create Task",
      );
}

function renderTaskTable(tasks, showActions) {
  const rows = tasks
    .map(
      (t) => `
    <tr class="${t.status === "Completed" ? "row-done" : ""}">
      <td>
        <button class="checkbox ${t.status === "Completed" ? "checked" : ""}"
                data-toggle="${t.id}" title="Toggle complete">✓</button>
      </td>
      <td>
        <div class="task-title">${escape(t.title)}</div>
        ${t.description ? `<div class="task-desc">${escape(t.description.slice(0, 80))}${t.description.length > 80 ? "…" : ""}</div>` : ""}
      </td>
      ${showActions ? `<td>${escape(t.category || "General")}</td>` : ""}
      <td><span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span></td>
      <td><span class="badge badge-${statusClass(t.status)}">${t.status}</span></td>
      <td>${t.dueDate || "—"}</td>
      ${
        showActions
          ? `
      <td>
        <div class="actions">
          <button class="btn-icon" data-edit="${t.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" data-delete="${t.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>`
          : ""
      }
    </tr>
  `,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table class="task-table">
        <thead>
          <tr>
            <th style="width:50px"></th>
            <th>Task</th>
            ${showActions ? "<th>Category</th>" : ""}
            <th>Priority</th>
            <th>Status</th>
            <th>Due</th>
            ${showActions ? '<th style="width:100px">Actions</th>' : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function statusClass(s) {
  return s.toLowerCase().replace(/\s+/g, "-");
}
function isOverdue(t) {
  return t.dueDate && t.dueDate < todayISO() && t.status !== "Completed";
}
function emptyState(icon, title, msg, nav, btnText) {
  return `
    <div class="empty-state">
      <div class="icon">${icon}</div>
      <h3>${title}</h3>
      <p>${msg}</p>
      <button class="btn btn-primary" data-nav="${nav}">${btnText}</button>
    </div>`;
}

// ============================================================
// TASK ACTIONS (event delegation)
// ============================================================
document.body.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) return toggleTask(toggle.dataset.toggle);

  const edit = e.target.closest("[data-edit]");
  if (edit) return openEditForm(edit.dataset.edit);

  const del = e.target.closest("[data-delete]");
  if (del) return deleteTask(del.dataset.delete);
});

function toggleTask(id) {
  const tasks = DB.getTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.status = t.status === "Completed" ? "Pending" : "Completed";
  t.updatedAt = new Date().toISOString();
  DB.setTasks(tasks);
  if (state.view === "dashboard") renderDashboard();
  else renderTasks();
  refreshNotifications();
  flash(`Task marked as ${t.status.toLowerCase()}.`, "success");
}

async function deleteTask(id) {
  const ok = await confirmDialog(
    "Delete task?",
    "This action cannot be undone.",
  );
  if (!ok) return;
  DB.setTasks(DB.getTasks().filter((t) => t.id !== id));
  if (state.view === "dashboard") renderDashboard();
  else renderTasks();
  refreshNotifications();
  flash("Task deleted.", "success");
}

// ============================================================
// TASK FORM
// ============================================================
function openEditForm(id) {
  state.editingId = id;
  navigate("new");
}

function renderForm() {
  const isEdit = !!state.editingId;
  $("#form-title").textContent = isEdit ? "Edit Task" : "New Task";

  const topbarTitle = $("#topbar-title");
  if (topbarTitle) topbarTitle.textContent = isEdit ? "Edit Task" : "New Task";

  if (isEdit) {
    const t = DB.getTasks().find((x) => x.id === state.editingId);
    if (!t) {
      navigate("tasks");
      return;
    }
    $("#task-id").value = t.id;
    $("#task-title").value = t.title;
    $("#task-desc").value = t.description || "";
    $("#task-category").value = t.category || "General";
    $("#task-due").value = t.dueDate || "";
    $("#task-priority").value = t.priority;
    $("#task-status").value = t.status;
  } else {
    $("#task-form").reset();
    $("#task-id").value = "";
    $("#task-category").value = "General";
    $("#task-priority").value = "Medium";
    $("#task-status").value = "Pending";
  }
}

$("#task-form").onsubmit = (e) => {
  e.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) {
    flash("Title is required.", "error");
    return;
  }

  const tasks = DB.getTasks();
  const now = new Date().toISOString();

  if (state.editingId) {
    const t = tasks.find((x) => x.id === state.editingId);
    if (!t) return;
    Object.assign(t, {
      title,
      description: $("#task-desc").value.trim(),
      category: $("#task-category").value.trim() || "General",
      dueDate: $("#task-due").value || null,
      priority: $("#task-priority").value,
      status: $("#task-status").value,
      updatedAt: now,
    });
    flash("Task updated.", "success");
  } else {
    tasks.push({
      id: uid(),
      userId: state.user.id,
      title,
      description: $("#task-desc").value.trim(),
      category: $("#task-category").value.trim() || "General",
      dueDate: $("#task-due").value || null,
      priority: $("#task-priority").value,
      status: $("#task-status").value,
      createdAt: now,
      updatedAt: now,
    });
    flash("Task created.", "success");
  }

  DB.setTasks(tasks);
  state.editingId = null;
  navigate("tasks");
  refreshNotifications();
};

// ============================================================
// STATS COMPUTATION
// ============================================================
function computeStats(tasks) {
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "Pending").length,
    inProgress: tasks.filter((t) => t.status === "In Progress").length,
    completed: tasks.filter((t) => t.status === "Completed").length,
    highPriority: tasks.filter((t) => t.priority === "High").length,
    overdue: tasks.filter(isOverdue).length,
  };
}

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const tasks = DB.tasksFor(state.user.id);
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "Completed").length;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const overdue = tasks.filter(isOverdue).length;

  $("#report-stats").innerHTML = `
    <div class="stat-card"><span class="stat-value">${total}</span><span class="stat-label">Total Tasks</span></div>
    <div class="stat-card done"><span class="stat-value">${rate}%</span><span class="stat-label">Completion Rate</span></div>
    <div class="stat-card overdue"><span class="stat-value">${overdue}</span><span class="stat-label">Overdue</span></div>
  `;

  const byStatus = groupCount(tasks, "status");
  const byPriority = groupCount(tasks, "priority");
  const byCategory = groupCount(tasks, "category");

  $("#report-charts").innerHTML = `
    ${barCard("By Status", byStatus, total)}
    ${barCard("By Priority", byPriority, total, true)}
    ${barCard("By Category", byCategory, total)}
  `;
}

function groupCount(tasks, key) {
  return tasks.reduce((acc, t) => {
    const v = t[key] || "Unknown";
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

function barCard(title, data, total, colorByKey = false) {
  const rows = Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => {
      const pct = total ? ((count / total) * 100).toFixed(1) : 0;
      const extra = colorByKey ? `bar-${label.toLowerCase()}` : "";
      return `
        <div class="bar-row">
          <span class="bar-label">${escape(label)}</span>
          <div class="bar-track">
            <div class="bar-fill ${extra}" style="width:${pct}%"></div>
          </div>
          <span class="bar-count">${count}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="report-card">
      <h3>${title}</h3>
      ${rows || '<p class="muted">No data</p>'}
    </div>`;
}

// ============================================================
// EXPORTS
// ============================================================
$("#export-csv").onclick = () => {
  const tasks = DB.tasksFor(state.user.id);
  if (!tasks.length) {
    flash("No tasks to export.", "error");
    return;
  }

  const headers = [
    "ID",
    "Title",
    "Description",
    "Category",
    "Priority",
    "Status",
    "Due Date",
    "Created",
    "Updated",
  ];
  const rows = tasks.map((t) => [
    t.id,
    t.title,
    t.description || "",
    t.category || "General",
    t.priority,
    t.status,
    t.dueDate || "",
    new Date(t.createdAt).toLocaleString(),
    new Date(t.updatedAt).toLocaleString(),
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  downloadFile(
    csv,
    `tasks_${state.user.username}_${todayISO()}.csv`,
    "text/csv",
  );
  flash("CSV exported.", "success");
};

$("#export-pdf").onclick = () => {
  const tasks = DB.tasksFor(state.user.id);
  if (!tasks.length) {
    flash("No tasks to export.", "error");
    return;
  }

  const stats = computeStats(tasks);
  const rate = tasks.length
    ? Math.round((stats.completed / tasks.length) * 100)
    : 0;

  // Sort: overdue + pending first, then due date asc, then newest
  const sorted = [...tasks].sort((a, b) => {
    const aOver = isOverdue(a) ? 0 : 1;
    const bOver = isOverdue(b) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const rows = sorted
    .map((t) => {
      const overdue = isOverdue(t);
      return `
      <tr>
        <td class="c-title">
          <div class="t-name">${escape(t.title)}</div>
          ${t.description ? `<div class="t-desc">${escape(t.description.slice(0, 120))}${t.description.length > 120 ? "…" : ""}</div>` : ""}
        </td>
        <td>${escape(t.category || "General")}</td>
        <td><span class="pill pill-${t.priority.toLowerCase()}">${t.priority}</span></td>
        <td><span class="pill pill-${statusClass(t.status)}">${t.status}</span></td>
        <td class="${overdue ? "due-overdue" : ""}">
          ${t.dueDate || "—"}
          ${overdue ? '<div class="overdue-tag">Overdue</div>' : ""}
        </td>
      </tr>`;
    })
    .join("");

  const byStatus = groupCount(tasks, "status");
  const byPriority = groupCount(tasks, "priority");
  const statusPills = Object.entries(byStatus)
    .map(
      ([k, v]) =>
        `<span class="mini-pill">${escape(k)} <strong>${v}</strong></span>`,
    )
    .join("");
  const priorityPills = Object.entries(byPriority)
    .map(
      ([k, v]) =>
        `<span class="mini-pill">${escape(k)} <strong>${v}</strong></span>`,
    )
    .join("");

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const nowTime = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Task Report — ${escape(state.user.username)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
    color: #0f172a;
    background: #f8fafc;
    padding: 40px 24px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report {
    max-width: 900px;
    margin: 0 auto;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(15,23,42,0.08);
    border: 1px solid #e2e8f0;
  }
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #fff;
    padding: 32px 40px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
  }
  .logo-mark { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .logo-box {
    width: 40px; height: 40px;
    background: #4f46e5;
    border-radius: 10px;
    display: grid; place-items: center;
    font-weight: 700; font-size: 1.2rem;
  }
  .logo-text { font-size: 1rem; font-weight: 600; }
  .report-title { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
  .report-meta { color: #cbd5e1; font-size: 0.88rem; }
  .report-meta strong { color: #fff; font-weight: 500; }
  .header-right { text-align: right; color: #cbd5e1; font-size: 0.82rem; min-width: 180px; }
  .header-right .label { color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.72rem; margin-bottom: 3px; }
  .header-right .value { color: #fff; font-size: 0.88rem; font-weight: 500; }
  .header-right div { margin-bottom: 12px; }

  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #e2e8f0; }
  .kpi { padding: 22px 24px; border-right: 1px solid #e2e8f0; }
  .kpi:last-child { border-right: none; }
  .kpi-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 8px; }
  .kpi-value { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1; color: #0f172a; }
  .kpi-value.accent { color: #4f46e5; }
  .kpi-value.success { color: #10b981; }
  .kpi-value.danger { color: #ef4444; }
  .kpi-sub { font-size: 0.76rem; color: #94a3b8; margin-top: 4px; }

  .report-body { padding: 32px 40px; }
  .section-title {
    font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: #64748b; font-weight: 600; margin-bottom: 14px;
    padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;
  }
  .pills-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .mini-pill { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; color: #475569; }
  .mini-pill strong { color: #0f172a; font-weight: 600; margin-left: 4px; }

  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 8px; }
  thead th {
    background: #f8fafc; text-align: left; padding: 10px 14px;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;
  }
  tbody td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; vertical-align: top; color: #334155; }
  tbody tr:last-child td { border-bottom: none; }
  .c-title { width: 45%; }
  .t-name { font-weight: 500; color: #0f172a; margin-bottom: 2px; }
  .t-desc { font-size: 0.78rem; color: #94a3b8; line-height: 1.4; }

  .pill { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 500; border: 1px solid transparent; }
  .pill-low         { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
  .pill-medium      { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .pill-high        { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
  .pill-pending     { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .pill-in-progress { background: #eef2ff; color: #3730a3; border-color: #c7d2fe; }
  .pill-completed   { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }

  .due-overdue { color: #dc2626; font-weight: 500; }
  .overdue-tag { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: #ef4444; font-weight: 600; margin-top: 2px; }

  .report-footer {
    padding: 20px 40px; background: #f8fafc; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between;
    font-size: 0.78rem; color: #94a3b8;
  }
  .report-footer strong { color: #475569; font-weight: 500; }

  @media print {
    body { padding: 0; background: #fff; }
    .report { box-shadow: none; border: none; border-radius: 0; max-width: 100%; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kpi-value { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 0.5cm; size: A4; }
    tr { page-break-inside: avoid; }
  }
</style>
</head><body>

<div class="report">

  <header class="report-header">
    <div>
      <div class="logo-mark">
        <div class="logo-box">✓</div>
        <span class="logo-text">TaskManager</span>
      </div>
      <h1 class="report-title">Task Report</h1>
      <p class="report-meta">Prepared for <strong>${escape(state.user.username)}</strong>${state.user.email ? ` · ${escape(state.user.email)}` : ""}</p>
    </div>
    <div class="header-right">
      <div>
        <div class="label">Generated</div>
        <div class="value">${today}</div>
      </div>
      <div>
        <div class="label">Time</div>
        <div class="value">${nowTime}</div>
      </div>
      <div>
        <div class="label">Report ID</div>
        <div class="value">TM-${Date.now().toString(36).toUpperCase()}</div>
      </div>
    </div>
  </header>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Total Tasks</div>
      <div class="kpi-value">${stats.total}</div>
      <div class="kpi-sub">across all categories</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Completed</div>
      <div class="kpi-value success">${stats.completed}</div>
      <div class="kpi-sub">${rate}% completion rate</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">In Progress</div>
      <div class="kpi-value accent">${stats.inProgress}</div>
      <div class="kpi-sub">${stats.pending} pending</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Overdue</div>
      <div class="kpi-value ${stats.overdue > 0 ? "danger" : ""}">${stats.overdue}</div>
      <div class="kpi-sub">${stats.highPriority} high priority</div>
    </div>
  </div>

  <div class="report-body">

    <h2 class="section-title">Distribution</h2>
    <div class="pills-row">
      <span class="mini-pill">By Status: ${statusPills || "None"}</span>
    </div>
    <div class="pills-row">
      <span class="mini-pill">By Priority: ${priorityPills || "None"}</span>
    </div>

    <h2 class="section-title">Task Details</h2>
    <table>
      <thead>
        <tr>
          <th>Task</th>
          <th>Category</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Due Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

  </div>

  <footer class="report-footer">
    <span>TaskManager · Confidential</span>
    <span>Generated automatically on <strong>${today}</strong></span>
  </footer>

</div>

<script>window.onload = () => setTimeout(() => window.print(), 350);<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
};

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 🔔 NOTIFICATION BELL + REMINDERS
// ============================================================
const NOTIF_DAYS_SOON = 3; // "due soon" = within N days

function daysFromToday(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((due - now) / (1000 * 60 * 60 * 24));
}

/** Compute reminder groups for current user */
function getReminders() {
  const tasks = DB.tasksFor(state.user.id);
  const overdue = [];
  const today = [];
  const soon = [];

  tasks.forEach((t) => {
    if (t.status === "Completed" || !t.dueDate) return;
    const diff = daysFromToday(t.dueDate);
    if (diff === null) return;
    if (diff < 0) overdue.push({ task: t, diff });
    else if (diff === 0) today.push({ task: t, diff });
    else if (diff <= NOTIF_DAYS_SOON) soon.push({ task: t, diff });
  });

  return {
    overdue,
    today,
    soon,
    total: overdue.length + today.length + soon.length,
  };
}

/** Update bell badge + (re)render dropdown contents */
function refreshNotifications() {
  const bell = document.getElementById("notif-bell");
  if (!bell || !state.user) return;

  const { overdue, today, soon, total } = getReminders();

  // ---- Badge ----
  let badge = bell.querySelector(".notif-badge");
  if (total > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "notif-badge";
      bell.appendChild(badge);
    }
    badge.textContent = total > 9 ? "9+" : String(total);
    badge.style.display = "grid";
  } else if (badge) {
    badge.style.display = "none";
  }

  // ---- Dropdown panel ----
  let panel = document.getElementById("notif-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "notif-panel";
    panel.className = "notif-panel";
    bell.parentElement.style.position = "relative";
    bell.parentElement.appendChild(panel);
  }

  const item = (task, meta, kind) => `
    <a class="notif-item notif-${kind}" data-notif-task="${task.id}">
      <span class="notif-dot"></span>
      <span class="notif-content">
        <span class="notif-title">${escape(task.title)}</span>
        <span class="notif-meta">${escape(meta)}</span>
      </span>
    </a>`;

  const block = (label, entries, kind) =>
    entries.length
      ? `<div class="notif-group">
           <div class="notif-group-label">${label}</div>
           ${entries
             .map(({ task, diff }) => {
               const meta =
                 kind === "overdue"
                   ? `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} · ${task.dueDate}`
                   : kind === "today"
                     ? `Due today · ${task.dueDate}`
                     : `Due in ${diff} day${diff === 1 ? "" : "s"} · ${task.dueDate}`;
               return item(task, meta, kind);
             })
             .join("")}
         </div>`
      : "";

  panel.innerHTML = total
    ? `
      <div class="notif-header">
        <strong>Reminders</strong>
        <span class="notif-count">${total} task${total === 1 ? "" : "s"} need attention</span>
      </div>
      <div class="notif-body">
        ${block("Overdue", overdue, "overdue")}
        ${block("Due Today", today, "today")}
        ${block("Due Soon", soon, "soon")}
      </div>
      <div class="notif-footer">
        <a data-nav="tasks">View all tasks →</a>
      </div>`
    : `
      <div class="notif-empty">
        <div class="notif-empty-icon">🎉</div>
        <div>You're all caught up</div>
        <span>No upcoming deadlines</span>
      </div>`;
}

/** Show notification panel toggle */
function toggleNotifPanel() {
  const panel = document.getElementById("notif-panel");
  if (!panel) return;
  const isOpen = panel.classList.contains("open");
  document
    .querySelectorAll(".notif-panel.open")
    .forEach((p) => p.classList.remove("open"));
  if (!isOpen) panel.classList.add("open");
}
function closeNotifPanel() {
  document
    .querySelectorAll(".notif-panel.open")
    .forEach((p) => p.classList.remove("open"));
}

/** Show a toast reminder after login / dashboard load (once per session) */
function showReminderToast() {
  if (state.reminderShown || !state.user) return;
  const { overdue, today, soon, total } = getReminders();
  if (total === 0) return;

  state.reminderShown = true;

  const parts = [];
  if (overdue.length) parts.push(`<b>${overdue.length}</b> overdue`);
  if (today.length) parts.push(`<b>${today.length}</b> due today`);
  if (soon.length) parts.push(`<b>${soon.length}</b> due soon`);

  const toast = document.createElement("div");
  toast.className = "flash flash-info notif-toast";
  toast.innerHTML = `
    <span class="notif-toast-icon">🔔</span>
    <span>Reminder: ${parts.join(", ")}. <a data-nav="tasks" style="color:inherit;text-decoration:underline">View tasks</a></span>
  `;
  $("#flash-container").appendChild(toast);

  // Dismiss after 6s
  setTimeout(() => {
    toast.style.transition = "opacity 0.4s, transform 0.4s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-8px)";
    setTimeout(() => toast.remove(), 400);
  }, 6000);
}

/** Wire the bell button + outside-click close + nav clicks inside panel */
document.addEventListener("DOMContentLoaded", () => {
  // Bell click
  const bell = document.getElementById("notif-bell");
  if (bell) {
    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotifPanel();
    });
  }

  // Outside click closes panel
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".notif-panel") && !e.target.closest("#notif-bell")) {
      closeNotifPanel();
    }
  });

  // Clicking a notification item opens the task editor
  document.addEventListener("click", (e) => {
    const item = e.target.closest("[data-notif-task]");
    if (item) {
      e.preventDefault();
      closeNotifPanel();
      openEditForm(item.dataset.notifTask);
    }
  });

  // Esc closes notif panel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNotifPanel();
  });
});

// ============================================================
// BOOT
// ============================================================
(function init() {
  const session = DB.getSession();
  if (session) {
    const user = DB.getUsers().find((u) => u.id === session.userId);
    if (user) return startApp(user);
    DB.clearSession();
  }
  setAuthMode("login");
})();

// ============================================================
// LEGAL MODALS (Terms / Privacy)
// ============================================================
(function initLegalModals() {
  const openBtnTerms = document.getElementById("open-terms");
  const openBtnPrivacy = document.getElementById("open-privacy");
  const termsModal = document.getElementById("terms-modal");
  const privacyModal = document.getElementById("privacy-modal");

  if (!termsModal || !privacyModal) return;

  function openModal(el) {
    el.style.display = "grid";
    document.body.classList.add("modal-open");
    el.querySelector(".legal-close")?.focus();
  }

  function closeModal(el) {
    el.style.display = "none";
    if (
      termsModal.style.display === "none" &&
      privacyModal.style.display === "none"
    ) {
      document.body.classList.remove("modal-open");
    }
  }

  openBtnTerms?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal(termsModal);
  });

  openBtnPrivacy?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal(privacyModal);
  });

  [termsModal, privacyModal].forEach((modal) => {
    modal.querySelectorAll("[data-close-legal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(modal));
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (termsModal.style.display !== "none") closeModal(termsModal);
    if (privacyModal.style.display !== "none") closeModal(privacyModal);
  });
})();
