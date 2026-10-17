(() => {
  "use strict";

  const DB_NAME = "little-ledger-db";
  const DB_VERSION = 1;
  const STORES = { transactions: "transactions", budgets: "budgets" };
  const COLORS = ["#e96b45", "#1d6957", "#d7a13e", "#6d83b5", "#a56b9d", "#4c9a9a", "#9c7b55", "#75836d"];
  const CATEGORIES = {
    expense: [
      { id: "food", name: "餐饮", icon: "🍜" },
      { id: "transport", name: "交通", icon: "🚇" },
      { id: "shopping", name: "购物", icon: "🛍️" },
      { id: "housing", name: "居住", icon: "🏠" },
      { id: "entertainment", name: "娱乐", icon: "🎬" },
      { id: "medical", name: "医疗", icon: "💊" },
      { id: "education", name: "学习", icon: "📚" },
      { id: "other-expense", name: "其他", icon: "🧾" }
    ],
    income: [
      { id: "salary", name: "工资", icon: "💼" },
      { id: "bonus", name: "奖金", icon: "🎁" },
      { id: "investment", name: "理财", icon: "📈" },
      { id: "part-time", name: "兼职", icon: "🧰" },
      { id: "other-income", name: "其他", icon: "💰" }
    ]
  };
  const NOTE_PLACEHOLDERS = {
    food: "例如：西红柿、鸡蛋、午饭",
    transport: "例如：地铁、打车去公司",
    shopping: "例如：买了一双鞋",
    housing: "例如：房租、电费、物业费",
    entertainment: "例如：电影票、游戏充值",
    medical: "例如：感冒药、门诊挂号",
    education: "例如：买书、课程费用",
    "other-expense": "写下这笔钱具体花在了哪里",
    salary: "例如：10 月工资",
    bonus: "例如：季度奖金",
    investment: "例如：基金收益",
    "part-time": "例如：设计兼职收入",
    "other-income": "写下这笔收入的来源"
  };

  const state = {
    db: null,
    transactions: [],
    budgets: [],
    month: currentMonth(),
    statsDay: todayString(),
    filter: "all",
    transactionType: "expense",
    pendingImport: null,
    installPrompt: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      state.db = await openDatabase();
      await reloadData();
      bindEvents();
      $("#monthPicker").value = state.month;
      $("#dateInput").value = todayString();
      render();
      registerServiceWorker();
    } catch (error) {
      console.error(error);
      showToast("本地数据库初始化失败，请检查浏览器设置");
    }
  }

  function bindEvents() {
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.target)));
    $("#openSettings").addEventListener("click", () => switchView("settings"));
    $("#addTransaction").addEventListener("click", openNewTransaction);
    $("#monthPicker").addEventListener("change", (event) => {
      if (!event.target.value) return;
      state.month = event.target.value;
      syncStatsDay(true);
      render();
    });
    $("#previousMonth").addEventListener("click", () => stepMonth(-1));
    $("#nextMonth").addEventListener("click", () => stepMonth(1));
    $("#statsDayPicker").addEventListener("change", (event) => {
      if (!event.target.value) return;
      state.statsDay = event.target.value;
      renderStats();
    });
    $("#previousDay").addEventListener("click", () => stepStatsDay(-1));
    $("#nextDay").addEventListener("click", () => stepStatsDay(1));
    $$(".chip").forEach((button) => button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      $$(".chip").forEach((item) => item.classList.toggle("is-active", item === button));
      renderTransactions();
    }));
    $$(".segmented button").forEach((button) => button.addEventListener("click", () => setTransactionType(button.dataset.type)));
    $("#categoryInput").addEventListener("change", updateNotePrompt);
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => $("#" + button.dataset.close).close()));
    $("#transactionForm").addEventListener("submit", saveTransaction);
    $("#deleteTransaction").addEventListener("click", removeTransaction);
    $("#editBudget").addEventListener("click", openBudgetDialog);
    $("#budgetForm").addEventListener("submit", saveBudget);
    $("#exportJson").addEventListener("click", exportJson);
    $("#exportCsv").addEventListener("click", exportCsv);
    $("#chooseImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", prepareImport);
    $("#mergeImport").addEventListener("click", (event) => runImport(event, "merge"));
    $("#replaceImport").addEventListener("click", (event) => runImport(event, "replace"));
    $("#installApp").addEventListener("click", installApp);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      $("#installApp").hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      $("#installApp").hidden = true;
      showToast("小账本已安装");
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.transactions)) {
          const store = db.createObjectStore(STORES.transactions, { keyPath: "id" });
          store.createIndex("date", "date");
          store.createIndex("type", "type");
        }
        if (!db.objectStoreNames.contains(STORES.budgets)) {
          db.createObjectStore(STORES.budgets, { keyPath: "month" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("数据库升级被其他页面阻止"));
    });
  }

  function dbRequest(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try { request = operation(store); } catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const getAll = (store) => dbRequest(store, "readonly", (objectStore) => objectStore.getAll());
  const put = (store, value) => dbRequest(store, "readwrite", (objectStore) => objectStore.put(value));
  const remove = (store, key) => dbRequest(store, "readwrite", (objectStore) => objectStore.delete(key));
  const clear = (store) => dbRequest(store, "readwrite", (objectStore) => objectStore.clear());

  async function reloadData() {
    [state.transactions, state.budgets] = await Promise.all([
      getAll(STORES.transactions),
      getAll(STORES.budgets)
    ]);
  }

  function render() {
    $("#monthPicker").value = state.month;
    renderTransactions();
    renderStats();
    renderBudget();
  }

  function renderTransactions() {
    const monthTransactions = transactionsForMonth();
    const income = sum(monthTransactions.filter((item) => item.type === "income"));
    const expense = sum(monthTransactions.filter((item) => item.type === "expense"));
    $("#incomeAmount").textContent = money(income);
    $("#expenseAmount").textContent = money(expense);
    $("#balanceAmount").textContent = money(income - expense);

    const visible = monthTransactions
      .filter((item) => state.filter === "all" || item.type === state.filter)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
    const container = $("#transactionList");
    if (!visible.length) {
      container.innerHTML = `<div class="empty-state"><span>🪙</span><h3>${state.filter === "all" ? "这个月还没有账单" : "没有符合筛选的账单"}</h3><p>点击右下角的“＋”，记录第一笔收支。</p></div>`;
      return;
    }

    const groups = groupBy(visible, (item) => item.date);
    container.innerHTML = Object.entries(groups).map(([date, items]) => `
      <section class="day-group">
        <p class="day-label">${formatDay(date)} · ${items.length} 笔</p>
        ${items.map(transactionCard).join("")}
      </section>`).join("");
    $$(".transaction-card", container).forEach((button) => button.addEventListener("click", () => openEditTransaction(button.dataset.id)));
  }

  function transactionCard(item) {
    const category = getCategory(item.type, item.category);
    const sign = item.type === "income" ? "+" : "−";
    return `<button class="transaction-card" type="button" data-id="${escapeHtml(item.id)}" data-type="${item.type}">
      <span class="category-icon">${category.icon}</span>
      <span class="transaction-main"><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(item.note || "无备注")}</small></span>
      <span class="transaction-amount ${item.type}">${sign}${money(item.amount)}</span>
    </button>`;
  }

  function renderStats() {
    syncStatsDay();
    const items = transactionsForMonth();
    const income = sum(items.filter((item) => item.type === "income"));
    const expenses = items.filter((item) => item.type === "expense");
    const expense = sum(expenses);
    $("#statsMonthLabel").textContent = monthLabel(state.month);
    $("#statsIncome").textContent = money(income);
    $("#statsExpense").textContent = money(expense);
    $("#savingsRate").textContent = income > 0 ? `${Math.round(((income - expense) / income) * 100)}%` : "—";

    renderDailyPie(expenses);
    renderMonthlyLine(expenses);
    renderMonthlyCategories(expenses, expense);
  }

  function renderDailyPie(expenses) {
    const { first, last } = monthBounds(state.month);
    const picker = $("#statsDayPicker");
    picker.min = first;
    picker.max = last;
    picker.value = state.statsDay;
    $("#previousDay").disabled = state.statsDay <= first;
    $("#nextDay").disabled = state.statsDay >= last;

    const dailyExpenses = expenses.filter((item) => item.date === state.statsDay);
    const dailyTotal = sum(dailyExpenses);
    $("#dailySummary").textContent = `${formatDay(state.statsDay)} · ${dailyExpenses.length} 笔支出 · ${money(dailyTotal)}`;

    const categoryTotals = CATEGORIES.expense.map((category, index) => ({
      ...category,
      color: COLORS[index % COLORS.length],
      amount: sum(dailyExpenses.filter((item) => item.category === category.id))
    })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
    $("#dailyDonutTotal").textContent = compactMoney(dailyTotal);
    const donut = $("#dailyExpenseDonut");
    if (!categoryTotals.length) {
      donut.style.background = "conic-gradient(#e3ded3 0 100%)";
      $("#dailyCategoryLegend").innerHTML = `<p class="muted">这一天暂无支出</p>`;
    } else {
      let cursor = 0;
      const stops = categoryTotals.map((item) => {
        const start = cursor;
        cursor += item.amount / dailyTotal * 100;
        return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
      });
      donut.style.background = `conic-gradient(${stops.join(",")})`;
      $("#dailyCategoryLegend").innerHTML = categoryTotals.map((item) => `
        <div class="legend-row"><i style="background:${item.color}"></i><span>${item.icon} ${item.name}</span><b>${money(item.amount)} · ${Math.round(item.amount / dailyTotal * 100)}%</b></div>`).join("");
    }
  }

  function renderMonthlyLine(expenses) {
    const [year, month] = state.month.split("-").map(Number);
    const days = new Date(year, month, 0).getDate();
    const amounts = Array.from({ length: days }, (_, index) => sum(expenses.filter((item) => Number(item.date.slice(-2)) === index + 1)));
    const rawMax = Math.max(...amounts, 0);
    const max = niceChartMax(rawMax);
    const width = 640;
    const height = 230;
    const left = 58;
    const right = 16;
    const top = 18;
    const bottom = 33;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const xFor = (index) => left + (days === 1 ? 0 : index / (days - 1) * plotWidth);
    const yFor = (amount) => top + (1 - amount / max) * plotHeight;
    const points = amounts.map((amount, index) => `${xFor(index).toFixed(1)},${yFor(amount).toFixed(1)}`).join(" ");
    const areaPath = `M ${left},${top + plotHeight} L ${points.split(" ").join(" L ")} L ${left + plotWidth},${top + plotHeight} Z`;
    const grid = [0, 1, 2, 3].map((index) => {
      const y = top + index / 3 * plotHeight;
      const value = max * (1 - index / 3);
      return `<line class="line-grid" x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"></line><text class="line-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${compactMoney(value)}</text>`;
    }).join("");
    const labelDays = [...new Set([1, 5, 10, 15, 20, 25, days].filter((day) => day <= days))];
    const xLabels = labelDays.map((day) => `<text class="line-axis-label" x="${xFor(day - 1)}" y="${height - 8}" text-anchor="middle">${day}</text>`).join("");
    const pointsMarkup = amounts.map((amount, index) => amount > 0 ? `<circle class="line-point" cx="${xFor(index)}" cy="${yFor(amount)}" r="4"><title>${index + 1} 日：${money(amount)}</title></circle>` : "").join("");

    $("#monthlyLineChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <defs><linearGradient id="monthlyAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e96b45" stop-opacity=".26"></stop><stop offset="100%" stop-color="#e96b45" stop-opacity=".02"></stop></linearGradient></defs>
      ${grid}<path class="line-area" d="${areaPath}"></path><polyline class="line-stroke" points="${points}"></polyline>${pointsMarkup}${xLabels}
    </svg>`;
    const peak = rawMax > 0 ? amounts.indexOf(rawMax) + 1 : 0;
    $("#monthlyAverage").textContent = `全月日均 ${money(sum(expenses) / days)}`;
    $("#monthlyPeak").textContent = peak ? `最高 ${peak} 日 · ${money(rawMax)}` : "本月暂无支出";
  }

  function renderMonthlyCategories(expenses, total) {
    const categories = CATEGORIES.expense.map((category, index) => {
      const entries = expenses.filter((item) => item.category === category.id);
      const notes = [...new Set(entries.map((item) => item.note?.trim()).filter(Boolean))];
      return { ...category, color: COLORS[index % COLORS.length], entries, notes, amount: sum(entries) };
    }).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
    const container = $("#monthlyCategoryList");
    if (!categories.length) {
      container.innerHTML = `<div class="empty-state"><span>🧾</span><h3>本月还没有支出</h3><p>记账时填写“钱花在哪里”，具体用途会整理在对应大类下面。</p></div>`;
      return;
    }
    container.innerHTML = categories.map((item) => {
      const percent = total > 0 ? item.amount / total * 100 : 0;
      const visibleNotes = item.notes.slice(0, 4);
      const moreCount = item.notes.length - visibleNotes.length;
      return `<article class="category-summary-card">
        <div class="category-summary-top">
          <span class="category-summary-icon">${item.icon}</span>
          <span class="category-summary-name"><strong>${item.name}</strong><small>${item.entries.length} 笔支出</small></span>
          <span class="category-summary-value"><b>${money(item.amount)}</b><small>${Math.round(percent)}%</small></span>
        </div>
        <div class="category-summary-progress"><i style="width:${percent}%;background:${item.color}"></i></div>
        ${visibleNotes.length ? `<div class="category-notes">${visibleNotes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}${moreCount > 0 ? `<span>另有 ${moreCount} 条</span>` : ""}</div>` : `<div class="category-notes"><span>这类支出还没有填写用途</span></div>`}
      </article>`;
    }).join("");
  }

  function renderBudget() {
    const budget = budgetForMonth();
    const expenses = transactionsForMonth().filter((item) => item.type === "expense");
    const spent = sum(expenses);
    const total = budget.total || 0;
    const ratio = total > 0 ? spent / total : 0;
    $("#budgetMonthLabel").textContent = monthLabel(state.month);
    $("#budgetSpent").textContent = money(spent);
    $("#budgetPercent").textContent = total > 0 ? `${Math.round(ratio * 100)}%` : "—";
    $("#budgetRing").style.background = `conic-gradient(${ratio > 1 ? "#e96b45" : "#1d6957"} 0 ${Math.min(ratio * 100, 100)}%, #e7e2d7 ${Math.min(ratio * 100, 100)}% 100%)`;
    const remaining = $("#budgetRemaining");
    if (!total) {
      remaining.textContent = "尚未设置总预算";
      remaining.classList.remove("over");
    } else if (spent <= total) {
      remaining.textContent = `还可使用 ${money(total - spent)}`;
      remaining.classList.remove("over");
    } else {
      remaining.textContent = `已超出 ${money(spent - total)}`;
      remaining.classList.add("over");
    }

    const configured = CATEGORIES.expense.map((category) => ({
      ...category,
      limit: Number(budget.categories[category.id]) || 0,
      spent: sum(expenses.filter((item) => item.category === category.id))
    })).filter((item) => item.limit > 0);
    const container = $("#categoryBudgets");
    if (!configured.length) {
      container.innerHTML = `<div class="empty-state"><span>🎯</span><h3>还没有分类预算</h3><p>设置餐饮、交通或购物预算，消费进度会显示在这里。</p></div>`;
      return;
    }
    container.innerHTML = configured.map((item) => {
      const percent = item.spent / item.limit * 100;
      const level = percent >= 100 ? "over" : percent >= 80 ? "warn" : "";
      return `<article class="budget-item">
        <div class="budget-item-head"><div><span>${item.icon}</span><strong>${item.name}</strong></div><p><b>${money(item.spent)}</b> / ${money(item.limit)}</p></div>
        <div class="progress-track"><i class="${level}" style="width:${Math.min(percent, 100)}%"></i></div>
      </article>`;
    }).join("");
  }

  function switchView(name) {
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.dataset.view === name));
    $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.target === name));
    $("#addTransaction").hidden = name === "settings";
    if (name === "stats") renderStats();
    if (name === "budget") renderBudget();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function stepMonth(amount) {
    const [year, month] = state.month.split("-").map(Number);
    const date = new Date(year, month - 1 + amount, 1);
    state.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    syncStatsDay(true);
    render();
  }

  function stepStatsDay(amount) {
    const [year, month, day] = state.statsDay.split("-").map(Number);
    const date = new Date(year, month - 1, day + amount);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const { first, last } = monthBounds(state.month);
    if (next < first || next > last) return;
    state.statsDay = next;
    renderStats();
  }

  function syncStatsDay(preferLatestTransaction = false) {
    const { first, last } = monthBounds(state.month);
    if (state.statsDay >= first && state.statsDay <= last) return;
    const latestExpenseDate = transactionsForMonth()
      .filter((item) => item.type === "expense")
      .map((item) => item.date)
      .sort((a, b) => b.localeCompare(a))[0];
    if (state.month === currentMonth()) state.statsDay = todayString();
    else state.statsDay = preferLatestTransaction && latestExpenseDate ? latestExpenseDate : first;
  }

  function openNewTransaction() {
    $("#transactionForm").reset();
    $("#transactionId").value = "";
    $("#transactionDialogTitle").textContent = "新增账单";
    $("#deleteTransaction").hidden = true;
    $("#transactionError").textContent = "";
    $("#dateInput").value = state.month === currentMonth() ? todayString() : `${state.month}-01`;
    setTransactionType("expense");
    $("#transactionDialog").showModal();
    setTimeout(() => $("#amountInput").focus(), 120);
  }

  function openEditTransaction(id) {
    const item = state.transactions.find((transaction) => transaction.id === id);
    if (!item) return;
    $("#transactionId").value = item.id;
    $("#transactionDialogTitle").textContent = "编辑账单";
    $("#amountInput").value = item.amount;
    $("#dateInput").value = item.date;
    $("#noteInput").value = item.note || "";
    $("#deleteTransaction").hidden = false;
    $("#transactionError").textContent = "";
    setTransactionType(item.type, item.category);
    $("#transactionDialog").showModal();
  }

  function setTransactionType(type, selectedCategory) {
    state.transactionType = type;
    $$(".segmented button").forEach((button) => button.classList.toggle("is-active", button.dataset.type === type));
    $("#categoryInput").innerHTML = CATEGORIES[type].map((category) => `<option value="${category.id}">${category.icon} ${category.name}</option>`).join("");
    if (selectedCategory && CATEGORIES[type].some((category) => category.id === selectedCategory)) {
      $("#categoryInput").value = selectedCategory;
    }
    updateNotePrompt();
  }

  function updateNotePrompt() {
    const category = $("#categoryInput").value;
    $("#noteLabelText").textContent = state.transactionType === "expense" ? "钱花在哪里（选填）" : "收入从哪里来（选填）";
    $("#noteInput").placeholder = NOTE_PLACEHOLDERS[category] || (state.transactionType === "expense" ? "写下这笔钱具体花在了哪里" : "写下这笔收入的来源");
  }

  async function saveTransaction(event) {
    event.preventDefault();
    const amount = Number($("#amountInput").value);
    const date = $("#dateInput").value;
    if (!Number.isFinite(amount) || amount <= 0 || !date) {
      $("#transactionError").textContent = "请填写大于 0 的金额和有效日期。";
      return;
    }
    const existingId = $("#transactionId").value;
    const old = state.transactions.find((item) => item.id === existingId);
    const item = {
      id: existingId || createId(),
      type: state.transactionType,
      amount: roundMoney(amount),
      date,
      category: $("#categoryInput").value,
      note: $("#noteInput").value.trim(),
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      await put(STORES.transactions, item);
      await reloadData();
      state.month = date.slice(0, 7);
      state.statsDay = date;
      $("#transactionDialog").close();
      render();
      showToast(existingId ? "账单已更新" : "账单已保存");
    } catch (error) {
      console.error(error);
      $("#transactionError").textContent = "保存失败，请稍后重试。";
    }
  }

  async function removeTransaction() {
    const id = $("#transactionId").value;
    if (!id || !window.confirm("确定删除这笔账单吗？此操作无法撤销。")) return;
    await remove(STORES.transactions, id);
    await reloadData();
    $("#transactionDialog").close();
    render();
    showToast("账单已删除");
  }

  function openBudgetDialog() {
    const budget = budgetForMonth();
    $("#totalBudgetInput").value = budget.total || "";
    $("#budgetInputs").innerHTML = CATEGORIES.expense.map((category) => `
      <label class="field"><span>${category.icon} ${category.name}</span><input type="number" min="0" step="1" inputmode="decimal" data-budget-category="${category.id}" value="${Number(budget.categories[category.id]) || ""}" placeholder="0" /></label>`).join("");
    $("#budgetDialog").showModal();
  }

  async function saveBudget(event) {
    event.preventDefault();
    const categories = {};
    $$("[data-budget-category]").forEach((input) => {
      const value = Math.max(0, Number(input.value) || 0);
      if (value > 0) categories[input.dataset.budgetCategory] = roundMoney(value);
    });
    const budget = {
      month: state.month,
      total: roundMoney(Math.max(0, Number($("#totalBudgetInput").value) || 0)),
      categories,
      updatedAt: new Date().toISOString()
    };
    await put(STORES.budgets, budget);
    await reloadData();
    $("#budgetDialog").close();
    renderBudget();
    showToast("预算已保存");
  }

  function exportJson() {
    const backup = {
      app: "小账本",
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      budgets: state.budgets
    };
    download(`小账本备份-${todayString()}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
    showToast("JSON 备份已导出");
  }

  function exportCsv() {
    const header = ["日期", "类型", "分类", "金额", "备注", "创建时间", "ID"];
    const rows = [...state.transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((item) => [item.date, item.type === "income" ? "收入" : "支出", getCategory(item.type, item.category).name, item.amount.toFixed(2), item.note || "", item.createdAt || "", item.id]);
    const csv = "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    download(`小账本明细-${todayString()}.csv`, csv, "text/csv;charset=utf-8");
    showToast("CSV 表格已导出");
  }

  async function prepareImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      state.pendingImport = validateBackup(raw);
      $("#importDialog").showModal();
    } catch (error) {
      console.error(error);
      state.pendingImport = null;
      showToast("无法读取备份：文件格式不正确");
    }
  }

  function validateBackup(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.transactions) || !Array.isArray(raw.budgets)) {
      throw new Error("缺少备份字段");
    }
    const transactions = raw.transactions.map((item) => {
      const type = item.type === "income" ? "income" : item.type === "expense" ? "expense" : null;
      const amount = Number(item.amount);
      if (!item.id || !type || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) throw new Error("无效账单");
      return {
        id: String(item.id), type, amount: roundMoney(amount), date: item.date,
        category: String(item.category || (type === "income" ? "other-income" : "other-expense")),
        note: String(item.note || "").slice(0, 120),
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || new Date().toISOString())
      };
    });
    const budgets = raw.budgets.map((item) => {
      if (!/^\d{4}-\d{2}$/.test(item.month || "")) throw new Error("无效预算");
      const categories = {};
      if (item.categories && typeof item.categories === "object") {
        Object.entries(item.categories).forEach(([key, value]) => {
          const number = Number(value);
          if (Number.isFinite(number) && number > 0) categories[key] = roundMoney(number);
        });
      }
      return { month: item.month, total: roundMoney(Math.max(0, Number(item.total) || 0)), categories, updatedAt: String(item.updatedAt || new Date().toISOString()) };
    });
    return { transactions, budgets };
  }

  async function runImport(event, mode) {
    event.preventDefault();
    if (!state.pendingImport) return;
    if (mode === "replace" && !window.confirm("覆盖导入会删除当前全部账单和预算，确定继续吗？")) return;
    try {
      if (mode === "replace") {
        await Promise.all([clear(STORES.transactions), clear(STORES.budgets)]);
      }
      for (const item of state.pendingImport.transactions) await put(STORES.transactions, item);
      for (const item of state.pendingImport.budgets) {
        if (mode === "merge") {
          const existing = state.budgets.find((budget) => budget.month === item.month);
          if (existing) item.categories = { ...existing.categories, ...item.categories };
        }
        await put(STORES.budgets, item);
      }
      await reloadData();
      const count = state.pendingImport.transactions.length;
      state.pendingImport = null;
      $("#importDialog").close();
      render();
      showToast(`已${mode === "replace" ? "覆盖" : "合并"}导入 ${count} 笔账单`);
    } catch (error) {
      console.error(error);
      showToast("导入失败，原文件可能已损坏");
    }
  }

  async function installApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $("#installApp").hidden = true;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service Worker 注册失败", error)));
  }

  function transactionsForMonth() {
    return state.transactions.filter((item) => item.date?.startsWith(state.month));
  }

  function budgetForMonth() {
    return state.budgets.find((item) => item.month === state.month) || { month: state.month, total: 0, categories: {} };
  }

  function getCategory(type, id) {
    return CATEGORIES[type]?.find((category) => category.id === id) || { id, name: "其他", icon: type === "income" ? "💰" : "🧾" };
  }

  function sum(items) { return roundMoney(items.reduce((total, item) => total + Number(item.amount || 0), 0)); }
  function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
  function money(value) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(Number(value) || 0); }
  function compactMoney(value) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0, notation: Math.abs(value) >= 10000 ? "compact" : "standard" }).format(Number(value) || 0); }
  function niceChartMax(value) {
    if (!Number.isFinite(value) || value <= 0) return 100;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return Math.ceil(value / magnitude) * magnitude;
  }
  function monthBounds(value) {
    const [year, month] = value.split("-").map(Number);
    const days = new Date(year, month, 0).getDate();
    return { first: `${value}-01`, last: `${value}-${String(days).padStart(2, "0")}` };
  }
  function currentMonth() { return todayString().slice(0, 7); }
  function todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  function monthLabel(value) {
    const [year, month] = value.split("-").map(Number);
    return `${year} 年 ${month} 月`;
  }
  function formatDay(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date(year, month - 1, day));
  }
  function createId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function groupBy(items, keyFn) { return items.reduce((result, item) => { const key = keyFn(item); (result[key] ||= []).push(item); return result; }, {}); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char])); }
  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
})();
