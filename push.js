'use strict';

/* =========================================================
   Reminder notifications.
   The phone can't wake the app up at a set time, so the app sends its
   list of upcoming reminders to a small server (push-server/, a
   Cloudflare Worker). The server sends each one as a push notification
   when it's due, even if the app is closed.

   - Tasks with a date AND a time: a notification at that time.
   - Daily summary (optional): "Today: 3 tasks" at the chosen time,
     plus how many emails came in (if email accounts are linked).
   - Weekly money recap (optional): Sunday evening, "Your week: $2,340 spent".
   The list is re-sent whenever tasks change and when the app is opened.
   ========================================================= */

const PushReminders = (() => {
  const PUSH_URL = 'https://life-dashboard-push.lifedash-reminders.workers.dev';
  const PUSH_PUBLIC_KEY = 'BDOOFamxUFpkgewOjAl3683NkQFqYCgZZaPp1ygYK4ksEl83QsA37tIyqIF7y5HTi-5qkpRg1i-sbqMd5f9r_M8';
  const DEVICE_KEY = 'lifedash:push'; // kept out of backups on purpose: it belongs to this phone
  const SUMMARY_DAYS = 30;
  const TIMED_DAYS = 60;

  let getState = () => ({ todos: [], settings: {} });
  let timer = null;
  let lastSent = '';

  /* ---------- This phone's registration ---------- */

  function device() {
    try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || null; } catch { return null; }
  }
  function saveDevice(d) {
    try { d ? localStorage.setItem(DEVICE_KEY, JSON.stringify(d)) : localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function status() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (device() && Notification.permission === 'granted') return 'on';
    return 'off';
  }

  async function subscription(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const key = Uint8Array.from(atob(PUSH_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    return sub;
  }

  async function post(path, body) {
    const res = await fetch(PUSH_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  /* ---------- What to remind about ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeLabel = (hhmm) => new Date(`2000-01-01T${hhmm}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ---------- Weekly money recap ---------- */

  const addDays = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return isoDay(d); };

  // The Sunday that ends this week (today if it's Sunday)
  function thisSunday() {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return isoDay(d);
  }

  // Recap of the Monday-Sunday week ending on `sunday`. Returns null if nothing was logged.
  function recapFor({ entries = [], settings = {} }, sunday = thisSunday()) {
    const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: settings.currency || 'MXN', maximumFractionDigits: 0 }).format(n);
    const inRange = (from, to) => entries.filter((e) => e.date >= from && e.date <= to);
    const week = inRange(addDays(sunday, -6), sunday);
    const last = inRange(addDays(sunday, -13), addDays(sunday, -7));
    const spent = week.filter((e) => e.type === 'expense');
    const total = spent.reduce((n, e) => n + e.amount, 0);
    const lastTotal = last.filter((e) => e.type === 'expense').reduce((n, e) => n + e.amount, 0);
    const income = week.filter((e) => e.type === 'income').reduce((n, e) => n + e.amount, 0);
    if (!total && !income) return null;

    if (settings.notifyHideNames) return { title: 'Your weekly recap is ready', body: 'Open the app to see how your week went.' };

    const byCat = {};
    for (const e of spent) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const lines = [];
    if (top.length) lines.push(top.map(([cat, n]) => `${cat} ${fmt(n)}`).join(' · '));
    if (lastTotal) {
      const pct = Math.round(((total - lastTotal) / lastTotal) * 100);
      lines.push(pct < 0 ? `${-pct}% less than last week 👏` : pct > 0 ? `${pct}% more than last week` : 'Same as last week');
    }
    const biggest = spent.reduce((a, e) => (!a || e.amount > a.amount ? e : a), null);
    if (biggest && spent.length > 1) lines.push(`Biggest: ${fmt(biggest.amount)} · ${(biggest.note || biggest.category).slice(0, 40)}`);
    if (income) lines.push(`Income ${fmt(income)}`);
    return { title: total ? `Your week: ${fmt(total)} spent` : 'Your week: no spending 🎉', body: lines.join('\n') };
  }

  function buildReminders({ todos, settings, entries = [] }) {
    const now = Date.now();
    const hide = !!settings.notifyHideNames;
    const open = todos.filter((t) => !t.done);
    const list = [];

    for (const t of open) {
      if (!t.due || !t.time) continue;
      const at = new Date(`${t.due}T${t.time}`).getTime();
      if (!(at > now) || at > now + TIMED_DAYS * 864e5) continue;
      list.push({
        id: `t:${t.id}`,
        at,
        title: hide ? 'Reminder' : t.text,
        body: hide ? `You have a task due at ${timeLabel(t.time)}` : `Due now · ${timeLabel(t.time)}`,
      });
    }

    if (settings.notifySummary !== false) {
      const time = settings.notifyTime || '09:00';
      const day = new Date();
      for (let i = 0; i < SUMMARY_DAYS; i++, day.setDate(day.getDate() + 1)) {
        const date = isoDay(day);
        const at = new Date(`${date}T${time}`).getTime();
        if (!(at > now)) continue;
        const dueThatDay = open.filter((t) => t.due === date);
        const overdue = open.filter((t) => t.due && t.due < date).length;
        if (!dueThatDay.length && (!overdue || i > 3)) continue; // overdue-only nags: just the next few days
        const title = dueThatDay.length ? `Today: ${plural(dueThatDay.length, 'task')}` : `${plural(overdue, 'task')} overdue`;
        let body;
        if (hide) body = 'Open the app to see them';
        else {
          body = dueThatDay.slice(0, 4).map((t) => t.text).join(' · ');
          if (dueThatDay.length > 4) body += ` · +${dueThatDay.length - 4} more`;
          if (overdue && dueThatDay.length) body += ` (and ${overdue} overdue)`;
          if (!dueThatDay.length) body = 'Open the app to catch up';
        }
        list.push({ id: `s:${date}`, at, title, body });
      }
      // Days with no tasks: an email-only summary. The server sends it only if there's new email.
      if (device()?.mail) {
        const day2 = new Date();
        for (let i = 0; i < SUMMARY_DAYS; i++, day2.setDate(day2.getDate() + 1)) {
          const date = isoDay(day2);
          const at = new Date(`${date}T${time}`).getTime();
          if (at > now && !list.some((r) => r.id === `s:${date}`)) list.push({ id: `m:${date}`, at, title: 'Email', body: '' });
        }
      }
    }
    // Next Sunday's money recap. It's rebuilt every time an expense is logged, so it's always current.
    if (settings.recapOn !== false) {
      const time = settings.recapTime || '20:00';
      let date = thisSunday();
      if (new Date(`${date}T${time}`).getTime() <= now) date = addDays(date, 7);
      const recap = recapFor({ entries, settings }, date);
      if (recap) list.push({ id: `w:${date}`, at: new Date(`${date}T${time}`).getTime(), ...recap });
    }

    return list.sort((a, b) => a.at - b.at).slice(0, 500);
  }

  /* ---------- Talking to the server ---------- */

  async function sync(force = false) {
    if (status() !== 'on') return;
    const sub = await subscription(true);
    const reminders = buildReminders(getState());
    const fingerprint = JSON.stringify([sub.endpoint, reminders, !!getState().settings.notifyHideNames]);
    if (!force && fingerprint === lastSent) return;
    const d = device() || {};
    const res = await post('/sync', { device: d.device, token: d.token, subscription: sub.toJSON(), reminders, hideNames: !!getState().settings.notifyHideNames });
    saveDevice({ ...d, device: res.device, token: res.token });
    lastSent = fingerprint;
  }

  // Called after every change: waits a moment so several quick edits send once
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => sync().catch(() => { lastSent = ''; }), 1500);
  }

  async function enable() {
    if (!supported()) throw new Error('This browser can’t show notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the phone’s app settings.');
    const sub = await subscription(true);
    const d = device() || {};
    const res = await post('/sync', {
      device: d.device, token: d.token, subscription: sub.toJSON(),
      reminders: buildReminders(getState()), hideNames: !!getState().settings.notifyHideNames,
    });
    saveDevice({ ...d, device: res.device, token: res.token });
    lastSent = '';
    return res.scheduled;
  }

  async function disable() {
    const d = device();
    saveDevice(null);
    lastSent = '';
    try { if (d) await post('/unregister', d); } catch { /* server unreachable: it forgets us when pushes fail */ }
    try { await (await subscription(false))?.unsubscribe(); } catch { /* ignore */ }
  }

  async function test() {
    await sync(true);
    await post('/test', device());
  }

  /* ---------- Email accounts (shown in the morning summary) ---------- */

  async function mailCall(path, extra = {}) {
    const d = device();
    if (!d) throw new Error('Turn on notifications first.');
    return post(path, { device: d.device, token: d.token, ...extra });
  }

  // Lists linked accounts and remembers how many, so email-only mornings get scheduled
  async function mailList() {
    const res = await mailCall('/mail/list');
    const d = device();
    if (d && d.mail !== res.accounts.length) {
      saveDevice({ ...d, mail: res.accounts.length });
      lastSent = '';
      schedule();
    }
    return res;
  }

  const addGmail = (email, password) => mailCall('/mail/add-gmail', { email, password });
  const microsoftSignInUrl = async () => (await mailCall('/mail/ms-start')).url;
  const removeMail = (id) => mailCall('/mail/remove', { id });
  const checkMail = () => mailCall('/mail/check');

  function init(stateGetter) {
    getState = stateGetter;
    // Coming back to the app: re-send so the 30-day summary window keeps rolling
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    schedule();
  }

  return {
    init, schedule, enable, disable, test, status, buildReminders, timeLabel, recapFor,
    mailList, addGmail, microsoftSignInUrl, removeMail, checkMail,
  };
})();
