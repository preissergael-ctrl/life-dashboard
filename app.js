'use strict';

/* =========================================================
   Life Dashboard: to-do list + money tracker.
   All data lives in this browser's localStorage.
   ========================================================= */

const STORAGE_KEY = 'lifedash:v1';

const CATEGORIES = {
  expense: ['Food', 'Transport', 'School', 'Fun', 'Shopping', 'Bills', 'Health', 'Other'],
  income: ['Allowance', 'Job', 'Gift', 'Other'],
};
// Which pixel-art drawing (in pixels.js) each category uses
const CATEGORY_ICON = {
  Food: 'burger', Transport: 'bus', School: 'books', Fun: 'controller', Shopping: 'bag', Bills: 'receipt',
  Health: 'firstaid', Other: 'box', Allowance: 'banknote', Job: 'briefcase', Gift: 'gift',
};
const catIcon = (cat, size = 24) => pixelIcon(CATEGORY_ICON[cat] || 'box', size);

/* ---------- Saving and loading ---------- */

function emptyState() {
  return { todos: [], entries: [], settings: { currency: 'MXN', aiModel: 'claude-opus-5-5' } };
}

function isValidState(s) {
  return s && Array.isArray(s.todos) && Array.isArray(s.entries);
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValidState(saved)) return { ...emptyState(), ...saved, settings: { ...emptyState().settings, ...saved.settings } };
  } catch { /* storage blocked or corrupt: start fresh */ }
  return emptyState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('Could not save. Storage may be full or blocked.');
  }
}

let state = load();

/* ---------- Screen state (not saved) ---------- */

const ui = {
  view: 'home',
  taskFilter: 'active',
  month: monthOf(todayISO()),
  entryType: 'expense',
  entryCat: 'Food',
  openCat: null, // category opened in "Spending by category"
};

/* ---------- Small helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthOf(iso) { return iso.slice(0, 7); }

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysFromToday(iso) {
  return Math.round((new Date(iso + 'T00:00') - new Date(todayISO() + 'T00:00')) / 86400000);
}

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(iso + 'T00:00').toLocaleDateString('en-US', opts);
}

function fmtMonth(key) {
  return new Date(key + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function money(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: state.settings.currency || 'MXN' }).format(n);
}

/* ---------- Tasks logic ---------- */

function sortTodos(list) {
  const key = (t) => t.due || '9999-12-31'; // tasks without a date go last
  return [...list].sort((a, b) =>
    (a.done - b.done) || key(a).localeCompare(key(b)) || (a.createdAt - b.createdAt));
}

function dueInfo(t) {
  if (!t.due) return null;
  if (t.done) return { label: fmtDate(t.due), cls: '' };
  const days = daysFromToday(t.due);
  if (days < 0) return { label: `Overdue · ${fmtDate(t.due)}`, cls: 'overdue' };
  if (days === 0) return { label: 'Today', cls: 'today' };
  if (days === 1) return { label: 'Tomorrow', cls: '' };
  return { label: fmtDate(t.due), cls: '' };
}

function todoHTML(t) {
  const due = dueInfo(t);
  return `
    <li class="todo${t.done ? ' done' : ''}">
      <label class="check">
        <input type="checkbox" data-action="toggle-todo" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Mark done">
        <span></span>
      </label>
      <div class="todo-body">
        <div class="todo-text">${esc(t.text)}</div>
        ${due ? `<div class="due ${due.cls}">${due.label}</div>` : ''}
      </div>
      <button class="icon-btn subtle" data-action="delete-todo" data-id="${t.id}" aria-label="Delete task">✕</button>
    </li>`;
}

/* ---------- Money logic ---------- */

function totalsFor(entries) {
  let income = 0, expense = 0;
  for (const e of entries) e.type === 'income' ? (income += e.amount) : (expense += e.amount);
  return { income, expense, balance: income - expense };
}

function totalsHTML({ income, expense, balance }) {
  return `
    <div class="total"><span>Income</span><strong class="pos">${money(income)}</strong></div>
    <div class="total"><span>Spent</span><strong class="neg">${money(expense)}</strong></div>
    <div class="total"><span>Balance</span><strong class="${balance < 0 ? 'neg' : ''}">${money(balance)}</strong></div>`;
}

function spendingByCategory(entries) {
  const sums = {};
  for (const e of entries) if (e.type === 'expense') sums[e.category] = (sums[e.category] || 0) + e.amount;
  return Object.entries(sums).sort((a, b) => b[1] - a[1]);
}

/* ---------- Rendering ---------- */

function renderHome() {
  const hour = new Date().getHours();
  $('#greeting').textContent = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';
  $('#today-label').textContent = fmtDate(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' });

  const today = todayISO();
  const open = state.todos.filter((t) => !t.done);
  const dueToday = open.filter((t) => t.due === today).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;
  $('#home-task-stats').innerHTML = `
    <span class="stat">${open.length} to do</span>
    <span class="stat ${dueToday ? 'today' : ''}">${dueToday} due today</span>
    <span class="stat ${overdue ? 'overdue' : ''}">${overdue} overdue</span>`;
  const next = sortTodos(open).slice(0, 4);
  $('#home-todos').innerHTML = next.length
    ? next.map(todoHTML).join('')
    : `<li class="empty">${pixelIcon('check', 32)}<br>Nothing to do. Nice!</li>`;

  const thisMonth = monthOf(today);
  const entries = state.entries.filter((e) => monthOf(e.date) === thisMonth);
  $('#home-month-title').textContent = fmtMonth(thisMonth);
  $('#home-totals').innerHTML = totalsHTML(totalsFor(entries));
  const top = spendingByCategory(entries)[0];
  $('#home-top-cat').innerHTML = top
    ? `Most spending: <span class="inline-cat">${catIcon(top[0], 18)} ${esc(top[0])}</span> (${money(top[1])})`
    : 'No spending logged this month yet.';
}

function renderTasks() {
  const open = state.todos.filter((t) => !t.done).length;
  const done = state.todos.length - open;
  $('#task-count').textContent = `${open} to do · ${done} done`;

  $$('#task-filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === ui.taskFilter));

  const shown = sortTodos(state.todos.filter((t) =>
    ui.taskFilter === 'all' ? true : ui.taskFilter === 'done' ? t.done : !t.done));
  const emptyMsg = { active: 'All caught up! Add a task above.', done: 'No completed tasks yet.', all: 'No tasks yet. Add one above.' };
  $('#todo-list').innerHTML = shown.length ? shown.map(todoHTML).join('') : `<li class="empty">${emptyMsg[ui.taskFilter]}</li>`;
  $('#clear-done').hidden = done === 0;
}

function renderCategoryOptions() {
  const cats = CATEGORIES[ui.entryType];
  if (!cats.includes(ui.entryCat)) ui.entryCat = cats[0];
  $('#entry-cats').innerHTML = cats.map((c) => `
    <button type="button" class="cat${c === ui.entryCat ? ' active' : ''}" role="radio"
      aria-checked="${c === ui.entryCat}" data-action="pick-cat" data-cat="${c}">
      ${catIcon(c, 32)}<span>${c}</span>
    </button>`).join('');
}

function renderMoney() {
  $('#month-label').textContent = fmtMonth(ui.month);
  const entries = state.entries.filter((e) => monthOf(e.date) === ui.month);
  $('#money-totals').innerHTML = totalsHTML(totalsFor(entries));

  $$('.seg').forEach((b) => b.classList.toggle('active', b.dataset.type === ui.entryType));
  $('#entry-submit').textContent = ui.entryType === 'expense' ? 'Add expense' : 'Add income';

  const cats = spendingByCategory(entries);
  const max = cats.length ? cats[0][1] : 0;
  $('#cat-card').hidden = cats.length === 0;
  $('#cat-bars').innerHTML = cats.map(([cat, amt]) => {
    const open = ui.openCat === cat;
    let list = '';
    if (open) {
      const items = entries
        .filter((e) => e.type === 'expense' && e.category === cat)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      list = `<div class="cat-detail">
        <p class="muted small">${items.length} transaction${items.length === 1 ? '' : 's'} in ${fmtMonth(ui.month)}</p>
        ${items.map((e) => `
          <button class="entry entry-tap" data-action="edit-cat" data-id="${e.id}">
            <span class="entry-body">
              <span>${esc(e.note || cat)}</span>
              <span class="muted small">${fmtDate(e.date)} · tap to change category</span>
            </span>
            <strong class="neg">−${money(e.amount)}</strong>
          </button>`).join('')}
      </div>`;
    }
    return `
    <button class="bar-row" data-action="toggle-cat" data-cat="${esc(cat)}" aria-expanded="${open}">
      <span class="bar-label">${catIcon(cat, 20)}${esc(cat)}</span>
      <span class="bar"><span style="width:${Math.max(4, (amt / max) * 100)}%"></span></span>
      <span class="bar-amt">${money(amt)}</span>
      <span class="bar-chev" aria-hidden="true">›</span>
    </button>${list}`;
  }).join('');

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!sorted.length) {
    $('#entry-list').innerHTML = `<p class="empty">Nothing logged in ${fmtMonth(ui.month)}.</p>`;
    return;
  }
  let html = '', lastDate = '';
  for (const e of sorted) {
    if (e.date !== lastDate) {
      html += `<div class="date-head">${fmtDate(e.date)}</div>`;
      lastDate = e.date;
    }
    html += `
      <div class="entry">
        <button class="entry-tap" data-action="edit-cat" data-id="${e.id}" aria-label="Change category of this entry">
          <span class="entry-ico">${catIcon(e.category, 24)}</span>
          <span class="entry-body">
            <span class="entry-cat">${esc(e.category)} <span class="edit-hint" aria-hidden="true"></span></span>
            ${e.note ? `<span class="muted small">${esc(e.note)}</span>` : ''}
          </span>
        </button>
        <strong class="${e.type === 'income' ? 'pos' : 'neg'}">${e.type === 'income' ? '+' : '−'}${money(e.amount)}</strong>
        <button class="icon-btn subtle" data-action="delete-entry" data-id="${e.id}" aria-label="Delete entry">✕</button>
      </div>`;
  }
  $('#entry-list').innerHTML = html;
}

function render() {
  renderHome();
  renderTasks();
  renderMoney();
  renderAI();
  $('#currency').value = state.settings.currency;
}

function showView(name) {
  ui.view = name;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.to === name ? 'page' : 'false'));
  window.scrollTo(0, 0);
}

/* ---------- Toast with optional Undo ---------- */

let undoFn = null;
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.querySelector('.toast-msg').textContent = msg;
  el.querySelector('.toast-undo').hidden = !undo;
  undoFn = undo || null;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); undoFn = null; }, 4500);
}

function commit() { save(); render(); }

/* ---------- Actions (button clicks) ---------- */

const actions = {
  go: (el) => showView(el.dataset.to),

  'quick-task': () => { showView('tasks'); $('#todo-text').focus(); },
  'quick-expense': () => {
    ui.entryType = 'expense';
    ui.month = monthOf(todayISO());
    renderCategoryOptions();
    renderMoney();
    showView('money');
    $('#entry-amount').focus();
  },

  filter: (el) => { ui.taskFilter = el.dataset.filter; renderTasks(); },

  'delete-todo': (el) => {
    const i = state.todos.findIndex((t) => t.id === el.dataset.id);
    if (i < 0) return;
    const [removed] = state.todos.splice(i, 1);
    commit();
    toast('Task deleted', () => { state.todos.splice(i, 0, removed); commit(); });
  },

  'clear-done': () => {
    const before = state.todos;
    const count = before.filter((t) => t.done).length;
    state.todos = before.filter((t) => !t.done);
    commit();
    toast(`Cleared ${count} completed task${count === 1 ? '' : 's'}`, () => { state.todos = before; commit(); });
  },

  month: (el) => { ui.month = shiftMonth(ui.month, Number(el.dataset.delta)); renderMoney(); },

  'entry-type': (el) => { ui.entryType = el.dataset.type; renderCategoryOptions(); renderMoney(); },

  'toggle-cat': (el) => { ui.openCat = ui.openCat === el.dataset.cat ? null : el.dataset.cat; renderMoney(); },
  'pick-cat': (el) => { ui.entryCat = el.dataset.cat; renderCategoryOptions(); },

  'edit-cat': (el) => openCatSheet(el.dataset.id),
  'sheet-cat': (el) => changeCategory(el.dataset.cat),
  'sheet-close': () => $('#cat-sheet').close(),

  'delete-entry': (el) => {
    const i = state.entries.findIndex((e) => e.id === el.dataset.id);
    if (i < 0) return;
    const [removed] = state.entries.splice(i, 1);
    commit();
    toast('Entry deleted', () => { state.entries.splice(i, 0, removed); commit(); });
  },

  export: () => {
    const data = JSON.stringify({ app: 'life-dashboard', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `life-dashboard-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  },

  erase: () => {
    if (!confirm('Erase ALL tasks and money entries? Download a backup first if you might want them back.')) return;
    const before = state;
    state = emptyState();
    commit();
    toast('All data erased', () => { state = before; commit(); });
  },

  undo: () => {
    if (undoFn) undoFn();
    undoFn = null;
    $('#toast').classList.remove('show');
  },

  'ai-lock': () => { window.LifeAI?.lock(); renderAI(); toast('AI locked'); },

  'ai-remove': () => {
    if (!confirm('Remove your saved API key from this device?')) return;
    window.LifeAI?.removeKey();
    $('#ask-reply').hidden = true;
    renderAI();
    toast('API key removed');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.type === 'checkbox') return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.action === 'toggle-todo') {
    const t = state.todos.find((x) => x.id === el.dataset.id);
    if (t) { t.done = el.checked; commit(); }
  }
});

/* ---------- Forms ---------- */

$('#todo-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = $('#todo-text').value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, due: $('#todo-due').value || '', done: false, createdAt: Date.now() });
  if (ui.taskFilter === 'done') ui.taskFilter = 'active';
  commit();
  $('#todo-text').value = '';
  $('#todo-due').value = '';
  $('#todo-text').focus();
});

$('#entry-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const amount = Math.round(parseFloat($('#entry-amount').value) * 100) / 100;
  if (!(amount > 0)) { toast('Enter an amount greater than 0'); return; }
  const date = $('#entry-date').value || todayISO();
  state.entries.push({
    id: uid(), type: ui.entryType, amount, category: ui.entryCat,
    note: $('#entry-note').value.trim(), date, createdAt: Date.now(),
  });
  ui.month = monthOf(date); // jump to the month you just logged
  commit();
  $('#entry-amount').value = '';
  $('#entry-note').value = '';
  toast(`${ui.entryType === 'expense' ? 'Expense' : 'Income'} of ${money(amount)} added`);
});

$('#currency').addEventListener('change', (ev) => {
  state.settings.currency = ev.target.value;
  commit();
});

$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed.data || parsed;
    if (!isValidState(data)) throw new Error('bad file');
    if (!confirm(`Replace your current data with this backup (${data.todos.length} tasks, ${data.entries.length} entries)?`)) return;
    const before = state;
    state = { ...emptyState(), ...data, settings: { ...emptyState().settings, ...data.settings } };
    commit();
    toast('Backup restored', () => { state = before; commit(); });
  } catch {
    toast("That file isn't a Life Dashboard backup.");
  }
});

/* ---------- AI assistant (the API part lives in ai.js) ---------- */

function renderAI() {
  const ai = window.LifeAI;
  const status = ai ? ai.status() : 'loading';
  $('#ask-card').hidden = status === 'loading';
  $('#ask-setup').hidden = status !== 'none';
  $('#unlock-form').hidden = status !== 'locked';
  $('#ask-form').hidden = status !== 'unlocked';
  $('#ai-setup-wrap').hidden = status !== 'none';
  $('#ai-ready-wrap').hidden = status === 'none' || status === 'loading';
  $('#ai-lock-btn').hidden = status !== 'unlocked';
  $('#ai-status').textContent = status === 'unlocked'
    ? 'Key saved · unlocked until you close the app.'
    : 'Key saved · locked. Unlock it from the Ask box on Home.';
  $('#ai-model').value = state.settings.aiModel || 'claude-opus-5-5';
  $('#ask-model').textContent = ai?.MODELS[state.settings.aiModel] || '';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Applies Claude's actions after checking every field. Returns a line describing each change. */
function applyAIActions(actions) {
  const changes = [];
  for (const a of actions) {
    if (a.kind === 'add_task') {
      const text = String(a.task_text || '').trim().slice(0, 200);
      if (!text) continue;
      const due = ISO_DATE.test(a.due) ? a.due : '';
      state.todos.push({ id: uid(), text, due, done: false, createdAt: Date.now() });
      changes.push(`New task: ${text}${due ? ` (${dueInfo({ due }).label})` : ''}`);
    } else if (a.kind === 'complete_task') {
      const t = state.todos.find((x) => x.id === a.task_id && !x.done);
      if (!t) continue;
      t.done = true;
      changes.push(`Done: ${t.text}`);
    } else if (a.kind === 'add_entry') {
      if (a.entry_type !== 'income' && a.entry_type !== 'expense') continue;
      const amount = Math.round(Number(a.amount) * 100) / 100;
      if (!(amount > 0) || amount > 1e9) continue;
      const category = CATEGORIES[a.entry_type].includes(a.category) ? a.category : 'Other';
      const note = String(a.note || '').trim().slice(0, 100);
      const date = ISO_DATE.test(a.date) ? a.date : todayISO();
      state.entries.push({ id: uid(), type: a.entry_type, amount, category, note, date, createdAt: Date.now() });
      changes.push(`${a.entry_type === 'income' ? 'Income' : 'Expense'}: ${money(amount)} · ${category}${note ? ` · ${note}` : ''}`);
    }
  }
  return changes;
}

function showAskReply(text, changes = [], isError = false) {
  const box = $('#ask-reply');
  box.hidden = false;
  box.classList.toggle('error', isError);
  box.innerHTML = `<p>${esc(text)}</p>${changes.length ? `<ul>${changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}`;
}

$('#ask-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('#ask-text');
  const text = input.value.trim();
  if (!text || !window.LifeAI) return;
  const send = $('#ask-send');
  send.disabled = true;
  send.textContent = 'Thinking…';
  try {
    const today = todayISO();
    const result = await window.LifeAI.ask(text, state.settings.aiModel, {
      today,
      weekday: new Date(today + 'T00:00').toLocaleDateString('en-US', { weekday: 'long' }),
      currency: state.settings.currency,
      expenseCategories: CATEGORIES.expense,
      incomeCategories: CATEGORIES.income,
      openTasks: sortTodos(state.todos.filter((t) => !t.done)).slice(0, 50).map(({ id, text, due }) => ({ id, text, due })),
    });
    const before = structuredClone(state);
    const changes = applyAIActions(result.actions);
    if (changes.length) {
      commit();
      toast(`${changes.length} change${changes.length === 1 ? '' : 's'} made`, () => { state = before; commit(); });
    }
    showAskReply(result.reply || (changes.length ? 'Done!' : 'Nothing to add.'), changes);
    input.value = '';
  } catch (err) {
    showAskReply(err.message || 'Something went wrong.', [], true);
  } finally {
    send.disabled = false;
    send.textContent = 'Send';
  }
});

$('#unlock-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pass = $('#unlock-pass');
  try {
    await window.LifeAI.unlock(pass.value);
    pass.value = '';
    renderAI();
    $('#ask-text').focus();
  } catch (err) {
    toast(err.message);
    pass.select();
  }
});

$('#ai-setup-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const key = $('#ai-key').value.trim();
  const pass = $('#ai-pass').value;
  if (!key.startsWith('sk-ant-')) { toast("That doesn't look like a Claude API key (it starts with sk-ant-)."); return; }
  if (pass.length < 6) { toast('Use a password with at least 6 characters.'); return; }
  if (pass !== $('#ai-pass2').value) { toast("The passwords don't match."); return; }
  try {
    await window.LifeAI.saveKey(key, pass);
  } catch {
    toast('Could not save the key on this device.');
    return;
  }
  $('#ai-setup-form').reset();
  renderAI();
  toast('AI is ready. Try it from the Home screen!');
});

$('#ai-model').addEventListener('change', (ev) => {
  state.settings.aiModel = ev.target.value;
  commit();
});

window.addEventListener('lifeai-ready', renderAI);

/* ---------- Keep in sync ---------- */

// Another tab changed the data
window.addEventListener('storage', (ev) => { if (ev.key === STORAGE_KEY) { state = load(); render(); } });
// Coming back to the app (e.g. the next day): refresh "today" labels
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------- PDF bank import ---------- */

let pendingImport = null;

function isDuplicateEntry(e) {
  return state.entries.some((x) => x.date === e.date && x.amount === e.amount && x.type === e.type);
}

function renderImportPreview({ entries, payments, files, errors }) {
  const dupes = entries.filter(isDuplicateEntry).length;
  const fresh = entries.length - dupes;

  pendingImport = entries;

  $('#csv-preview-title').textContent = `${entries.length} transaction${entries.length === 1 ? '' : 's'} found`;

  const parts = [`From ${files} file${files === 1 ? '' : 's'}`, `${fresh} new`];
  if (dupes)    parts.push(`${dupes} already in app (will be skipped)`);
  if (payments) parts.push(`${payments} card payment${payments === 1 ? '' : 's'} skipped`);
  $('#csv-preview-summary').textContent = parts.join(' · ');

  let html = errors.map((msg) => `<p class="small neg">${esc(msg)}</p>`).join('');
  const MAX_SHOWN = 60;
  for (const e of entries.slice(0, MAX_SHOWN)) {
    const dup = isDuplicateEntry(e);
    html += `
      <div class="entry${dup ? ' csv-dup' : ''}">
        <span class="entry-ico">${catIcon(e.category, 24)}</span>
        <div class="entry-body">
          <div>${esc(e.description.slice(0, 60) || e.category)}</div>
          <div class="muted small">${fmtDate(e.date)} · ${esc(e.category)}${dup ? ' · already in app' : ''}</div>
        </div>
        <strong class="${e.type === 'income' ? 'pos' : 'neg'}">${e.type === 'income' ? '+' : '−'}${money(e.amount)}</strong>
      </div>`;
  }
  if (entries.length > MAX_SHOWN) {
    html += `<p class="muted small" style="text-align:center;padding:10px 0">…and ${entries.length - MAX_SHOWN} more</p>`;
  }
  $('#csv-preview-list').innerHTML = html;

  const btn = $('#csv-import-btn');
  btn.disabled = fresh === 0;
  btn.textContent = fresh === 0 ? 'Nothing new to import' : `Import ${fresh} new entr${fresh === 1 ? 'y' : 'ies'}`;

  $('#csv-preview-wrap').hidden = false;
  $('#csv-preview-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearImportPreview() {
  pendingImport = null;
  $('#csv-preview-wrap').hidden = true;
  $('#csv-preview-list').innerHTML = '';
  $('#pdf-file').value = '';
}

// `?.` = if the button is missing (e.g. an old cached page), skip instead of crashing the whole app
document.getElementById('pdf-file')?.addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  if (!files.length) return;
  const label = $('#pdf-import-label');
  const original = label.childNodes[0].textContent;

  const entries = [];
  const seen = new Set(); // the same statement picked twice shouldn't double up
  const errors = [];
  let payments = 0, ok = 0;

  for (const [i, file] of files.entries()) {
    label.childNodes[0].textContent = files.length > 1 ? `Reading ${i + 1} of ${files.length}…` : 'Reading PDF…';
    try {
      const parsed = await PDFImport.parse(file);
      ok++;
      payments += parsed.payments;
      for (const e of parsed.entries) {
        const key = `${e.date}|${e.amount}|${e.type}|${e.description}`;
        if (!seen.has(key)) { seen.add(key); entries.push(e); }
      }
    } catch (err) {
      errors.push(`${file.name}: ${err.message || 'could not read it.'}`);
    }
  }
  label.childNodes[0].textContent = original;

  if (!ok) {
    toast(errors.length === 1 ? errors[0] : `None of the ${files.length} files could be read.`);
    ev.target.value = '';
    return;
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  renderImportPreview({ entries, payments, files: files.length, errors });
});

actions['csv-confirm'] = () => {
  if (!pendingImport) return;
  const toAdd = pendingImport.filter((e) => !isDuplicateEntry(e));
  if (!toAdd.length) { clearImportPreview(); return; }
  const before = structuredClone(state);
  for (const e of toAdd) {
    state.entries.push({ id: uid(), type: e.type, amount: e.amount, category: e.category, note: e.note, date: e.date, createdAt: Date.now() });
  }
  commit();
  clearImportPreview();
  toast(`${toAdd.length} entr${toAdd.length === 1 ? 'y' : 'ies'} imported`, () => { state = before; commit(); });
};

actions['csv-cancel'] = clearImportPreview;

/* ---------- Change an entry's category ---------- */

let sheetEntryId = null;

// Other entries from the same merchant (same note + type), so they can be moved together
function sameMerchant(entry) {
  if (!entry.note) return [];
  const key = entry.note.trim().toLowerCase();
  return state.entries.filter((x) => x.id !== entry.id && x.type === entry.type && (x.note || '').trim().toLowerCase() === key);
}

function openCatSheet(id) {
  const e = state.entries.find((x) => x.id === id);
  const sheet = $('#cat-sheet');
  if (!e || !sheet.showModal) return;
  sheetEntryId = id;
  $('#sheet-sub').textContent = `${e.note || e.category} · ${e.type === 'income' ? '+' : '−'}${money(e.amount)} · ${fmtDate(e.date)}`;
  $('#sheet-cats').innerHTML = CATEGORIES[e.type].map((c) => `
    <button type="button" class="cat${c === e.category ? ' active' : ''}" data-action="sheet-cat" data-cat="${c}">
      ${catIcon(c, 32)}<span>${c}</span>
    </button>`).join('');
  const others = sameMerchant(e);
  $('#sheet-all-wrap').hidden = others.length === 0;
  $('#sheet-all').checked = false;
  $('#sheet-all-label').textContent = `Also change the other ${others.length} “${e.note}” entr${others.length === 1 ? 'y' : 'ies'}`;
  sheet.showModal();
}

function changeCategory(cat) {
  const e = state.entries.find((x) => x.id === sheetEntryId);
  $('#cat-sheet').close();
  if (!e) return;
  const targets = [e, ...($('#sheet-all').checked ? sameMerchant(e) : [])].filter((x) => x.category !== cat);
  if (!targets.length) return;
  const before = targets.map((x) => [x, x.category]);
  for (const x of targets) x.category = cat;
  commit();
  toast(targets.length === 1 ? `Moved to ${cat}` : `${targets.length} entries moved to ${cat}`,
    () => { for (const [x, old] of before) x.category = old; commit(); });
}

// Tap the dark area outside the sheet to close it
$('#cat-sheet')?.addEventListener('click', (ev) => { if (ev.target.id === 'cat-sheet') ev.target.close(); });

/* ---------- Start ---------- */

$('#entry-date').value = todayISO();
$$('[data-icon]').forEach((el) => { el.innerHTML = pixelIcon(el.dataset.icon, 26); });
renderCategoryOptions();
render();
showView('home');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode unavailable */ });
}
