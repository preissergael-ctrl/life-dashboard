// Email check for the morning summary: "📧 7 new — Gmail 4 · Tec 3 · From Prof. Ruiz, Amazon, Mom".
//
// - Gmail: IMAP (imap.gmail.com) with a Gmail "app password". Only the Primary tab counts.
// - Microsoft (school Microsoft 365 / Outlook.com / Hotmail): Microsoft Graph with OAuth sign-in.
//
// Nothing is ever changed in the inbox: IMAP opens it read-only (EXAMINE + BODY.PEEK) and
// Graph only gets the Mail.Read permission. Only the sender line of each email is read.
// Passwords / sign-in tokens are stored encrypted (AES-GCM, key = MAIL_KEY secret).
//
// Secrets: MAIL_KEY (always), MS_CLIENT_SECRET (for Microsoft). Var: MS_CLIENT_ID.

import { connect } from 'cloudflare:sockets';

const MAX_ACCOUNTS = 6;            // per phone
const WINDOW_MS = 24 * 3600e3;     // "what I missed" = unread from the last 24 hours
const CHECK_TIMEOUT_MS = 20e3;
const MS_SCOPE = 'offline_access User.Read Mail.Read';

/* ---------------- Public helpers used by worker.js ---------------- */

export async function mailRoutes(env, path, body, device, origin) {
  if (path === '/mail/list') return { accounts: await listAccounts(env, device.id), microsoft: !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET) };
  if (path === '/mail/add-gmail') return addGmail(env, device.id, body);
  if (path === '/mail/ms-start') return msStart(env, device.id, origin);
  if (path === '/mail/remove') {
    await env.DB.prepare('DELETE FROM mail_accounts WHERE id = ? AND device_id = ?').bind(String(body.id), device.id).run();
    return { removed: true };
  }
  if (path === '/mail/check') return mailSummary(env, device.id, !!device.hide_names);
  return null;
}

// Builds the email part of the morning notification. Returns null when no email accounts are linked.
export async function mailSummary(env, deviceId, hideNames) {
  const { results: accounts } = await env.DB.prepare('SELECT * FROM mail_accounts WHERE device_id = ? ORDER BY created').bind(deviceId).all();
  if (!accounts.length) return null;

  const since = Date.now() - WINDOW_MS;
  const checks = await Promise.allSettled(accounts.map((a) => withTimeout(checkAccount(env, a, since), CHECK_TIMEOUT_MS)));

  const parts = [], errors = [], messages = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i], c = checks[i];
    if (c.status === 'fulfilled') {
      parts.push({ label: a.label, count: c.value.count });
      messages.push(...c.value.messages);
      await env.DB.prepare('UPDATE mail_accounts SET last_ok = ?, last_error = NULL WHERE id = ?').bind(Date.now(), a.id).run();
    } else {
      errors.push(a.label);
      console.log('mail check failed', a.label, c.reason?.message);
      await env.DB.prepare('UPDATE mail_accounts SET last_error = ? WHERE id = ?').bind(String(c.reason?.message || 'failed').slice(0, 200), a.id).run();
    }
  }

  const total = parts.reduce((n, p) => n + p.count, 0);
  const senders = [];
  for (const m of messages.sort((x, y) => y.at - x.at)) {
    if (m.from && !senders.includes(m.from)) senders.push(m.from);
    if (senders.length === 3) break;
  }

  let head;
  if (!total) head = '📧 No new email';
  else if (accounts.length === 1) head = `📧 ${plural(total, 'new email')}`;
  else head = `📧 ${total} new — ${parts.filter((p) => p.count).map((p) => `${p.label} ${p.count}`).join(' · ')}`;
  const lines = [head];
  if (total && senders.length && !hideNames) lines.push(`From ${senders.join(', ')}${total > senders.length ? '…' : ''}`);
  if (errors.length) lines.push(`⚠️ Couldn't check ${errors.join(', ')}`);
  return { total, errors: errors.length, text: lines.join('\n') };
}

export async function deleteDeviceMail(env, deviceId) {
  return env.DB.batch([
    env.DB.prepare('DELETE FROM mail_accounts WHERE device_id = ?').bind(deviceId),
    env.DB.prepare('DELETE FROM mail_pending WHERE device_id = ?').bind(deviceId),
  ]);
}

/* ---------------- Accounts ---------------- */

async function listAccounts(env, deviceId) {
  const { results } = await env.DB.prepare('SELECT id, kind, label, address, last_ok, last_error FROM mail_accounts WHERE device_id = ? ORDER BY created').bind(deviceId).all();
  return results.map((a) => ({ id: a.id, kind: a.kind, label: a.label, address: a.address, ok: !a.last_error, error: a.last_error }));
}

async function countAccounts(env, deviceId) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_accounts WHERE device_id = ?').bind(deviceId).first()).n;
}

async function saveAccount(env, deviceId, kind, address, secret) {
  address = address.toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM mail_accounts WHERE device_id = ? AND address = ?').bind(deviceId, address).first();
  if (!existing && await countAccounts(env, deviceId) >= MAX_ACCOUNTS) fail(`You can link up to ${MAX_ACCOUNTS} email accounts.`);
  const id = existing?.id || crypto.randomUUID();
  const enc = await encrypt(env, JSON.stringify(secret), id);
  await env.DB.prepare(`INSERT INTO mail_accounts (id, device_id, kind, label, address, secret, created, last_ok, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, last_ok = excluded.last_ok, last_error = NULL`)
    .bind(id, deviceId, kind, labelFor(address), address, enc, Date.now(), Date.now()).run();
  return { id, label: labelFor(address), address };
}

function labelFor(address) {
  const domain = address.split('@')[1] || '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'Gmail';
  if (domain === 'tec.mx' || domain.endsWith('.tec.mx')) return 'Tec';
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return 'Outlook';
  return domain.split('.')[0].replace(/^./, (c) => c.toUpperCase()) || 'Email';
}

async function checkAccount(env, account, since) {
  const secret = JSON.parse(await decrypt(env, account.secret, account.id));
  if (account.kind === 'gmail') return gmailCheck(env, account.address, secret.password, since);
  if (account.kind === 'microsoft') return msCheck(env, account, secret, since);
  fail('unknown account type');
}

/* ---------------- Gmail (IMAP) ---------------- */

async function addGmail(env, deviceId, body) {
  const email = String(body.email || '').trim();
  const password = String(body.password || '').replace(/\s+/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('That doesn’t look like an email address.');
  if (!/^[\x21-\x7e]{8,64}$/.test(password)) fail('Paste the 16-letter app password from Google.');
  try {
    await withTimeout(gmailCheck(env, email, password, Date.now() - WINDOW_MS), CHECK_TIMEOUT_MS);
  } catch (err) {
    if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(err.message)) {
      fail('Gmail didn’t accept that. Check the address and make a new app password.');
    }
    fail(`Couldn’t reach Gmail: ${err.message}`, 502);
  }
  return { account: await saveAccount(env, deviceId, 'gmail', email, { password }) };
}

async function gmailCheck(env, email, password, since) {
  // IMAP_TEST_ADDR lets local tests point at a fake server (plain TCP). Never set in production.
  const [host, port] = (env.IMAP_TEST_ADDR || 'imap.gmail.com:993').split(':');
  const imap = new Imap(connect({ hostname: host, port: Number(port) }, { secureTransport: env.IMAP_TEST_ADDR ? 'off' : 'on' }));
  try {
    await imap.greeting();
    await imap.command(`LOGIN ${imapQuote(email)} ${imapQuote(password)}`);
    await imap.command('EXAMINE INBOX'); // read-only: nothing gets marked as read
    const days = Math.max(1, Math.round((Date.now() - since) / 864e5));
    const search = await imap.command(`UID SEARCH X-GM-RAW ${imapQuote(`category:primary is:unread newer_than:${days}d`)}`);
    const uids = search.flatMap((r) => (r.line.match(/^\* SEARCH(.*)$/i)?.[1] || '').trim().split(/\s+/)).filter(Boolean).map(Number);
    const messages = [];
    const recent = uids.sort((a, b) => a - b).slice(-25);
    if (recent.length) {
      const res = await imap.command(`UID FETCH ${recent.join(',')} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM)])`);
      for (const r of res) {
        if (!/^\* \d+ FETCH/i.test(r.line)) continue;
        const date = r.line.match(/INTERNALDATE "([^"]+)"/i)?.[1];
        const at = date ? Date.parse(date.trim().replace(/^(\d+)-(\w+)-/, '$1 $2 ')) || 0 : 0;
        messages.push({ at, from: senderName(r.literals.join('')) });
      }
    }
    imap.command('LOGOUT').catch(() => {});
    return { count: uids.length, messages };
  } finally {
    imap.close();
  }
}

// A tiny IMAP client: just enough for LOGIN / EXAMINE / SEARCH / FETCH.
class Imap {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buf = new Uint8Array(0);
    this.n = 0;
  }

  async more() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error('mail server closed the connection');
    this.buf = concat(this.buf, value);
  }

  async line() {
    for (;;) {
      const i = indexOfCRLF(this.buf);
      if (i >= 0) {
        const text = new TextDecoder().decode(this.buf.subarray(0, i));
        this.buf = this.buf.subarray(i + 2);
        return text;
      }
      if (this.buf.length > 1e6) throw new Error('mail server response too long');
      await this.more();
    }
  }

  async bytes(n) {
    while (this.buf.length < n) await this.more();
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return new TextDecoder().decode(out);
  }

  // One response, with any {123} literals read in and kept separately.
  async response() {
    let line = '';
    const literals = [];
    for (;;) {
      const part = await this.line();
      const m = part.match(/\{(\d+)\}$/);
      if (!m) return { line: line + part, literals };
      line += part.slice(0, -m[0].length) + '{}';
      literals.push(await this.bytes(Number(m[1])));
    }
  }

  async greeting() {
    const r = await this.response();
    if (!/^\* (OK|PREAUTH)/i.test(r.line)) throw new Error(`unexpected greeting: ${r.line.slice(0, 80)}`);
  }

  async command(cmd) {
    const tag = `a${++this.n}`;
    await this.writer.write(new TextEncoder().encode(`${tag} ${cmd}\r\n`));
    const untagged = [];
    for (;;) {
      const r = await this.response();
      if (r.line.startsWith(`${tag} `)) {
        if (!/^\S+ OK/i.test(r.line)) throw new Error(r.line.slice(tag.length + 1, 200));
        return untagged;
      }
      untagged.push(r);
    }
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

const imapQuote = (s) => `"${String(s).replace(/[\\"]/g, (c) => `\\${c}`)}"`;

function indexOfCRLF(buf) {
  for (let i = 0; i + 1 < buf.length; i++) if (buf[i] === 13 && buf[i + 1] === 10) return i;
  return -1;
}

/* ---------------- Microsoft (Graph) ---------------- */

const msLogin = (env) => env.MS_TEST_LOGIN || 'https://login.microsoftonline.com/common/oauth2/v2.0';
const msGraph = (env) => env.MS_TEST_GRAPH || 'https://graph.microsoft.com/v1.0';

async function msStart(env, deviceId, origin) {
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) fail('Microsoft sign-in isn’t set up on the server yet.', 501);
  if (await countAccounts(env, deviceId) >= MAX_ACCOUNTS) fail(`You can link up to ${MAX_ACCOUNTS} email accounts.`);
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mail_pending WHERE created < ?').bind(Date.now() - 15 * 60e3),
    env.DB.prepare('INSERT INTO mail_pending (state, device_id, verifier, created) VALUES (?, ?, ?, ?)').bind(state, deviceId, verifier, Date.now()),
  ]);
  const url = new URL(`${msLogin(env)}/authorize`);
  url.search = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${origin}/mail/ms-callback`,
    response_mode: 'query',
    scope: MS_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: url.toString() };
}

// Microsoft sends the browser back here after the user signs in.
export async function msCallback(env, url) {
  const q = url.searchParams;
  const page = (ok, msg) => new Response(resultPage(ok, msg), { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const state = q.get('state') || '';
  const pending = await env.DB.prepare('SELECT * FROM mail_pending WHERE state = ?').bind(state).first();
  if (pending) await env.DB.prepare('DELETE FROM mail_pending WHERE state = ?').bind(state).run();
  if (q.get('error')) {
    const desc = q.get('error_description') || q.get('error');
    if (/AADSTS65001|AADSTS90094|admin/i.test(desc)) return page(false, 'Your school needs an administrator to approve this app before it can read your email. You can still use Gmail and personal Outlook accounts.');
    if (q.get('error') === 'access_denied') return page(false, 'Sign-in was cancelled.');
    return page(false, `Microsoft said: ${desc.split('\n')[0].slice(0, 200)}`);
  }
  if (!pending || pending.created < Date.now() - 15 * 60e3) return page(false, 'This sign-in link expired. Go back to the app and try again.');

  try {
    const tokens = await msToken(env, {
      grant_type: 'authorization_code',
      code: q.get('code') || '',
      redirect_uri: `${url.origin}/mail/ms-callback`,
      code_verifier: pending.verifier,
    });
    const me = await msFetch(env, '/me?$select=mail,userPrincipalName', tokens.access_token);
    const address = me.mail || me.userPrincipalName;
    if (!address) throw new Error('Microsoft did not share the email address');
    const account = await saveAccount(env, pending.device_id, 'microsoft', address, { refresh: tokens.refresh_token });
    return page(true, `${account.address} is connected. Go back to Life Dashboard; it’ll show up in a moment.`);
  } catch (err) {
    console.log('ms callback failed', err.message);
    return page(false, `Couldn’t finish connecting: ${err.message}`);
  }
}

async function msCheck(env, account, secret, since) {
  const tokens = await msToken(env, { grant_type: 'refresh_token', refresh_token: secret.refresh });
  if (tokens.refresh_token && tokens.refresh_token !== secret.refresh) {
    // Microsoft hands out a new refresh token each time; keep the newest one
    const enc = await encrypt(env, JSON.stringify({ refresh: tokens.refresh_token }), account.id);
    await env.DB.prepare('UPDATE mail_accounts SET secret = ? WHERE id = ?').bind(enc, account.id).run();
  }
  const sinceIso = new Date(since).toISOString().replace(/\.\d+Z$/, 'Z');
  const path = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso} and isRead eq false`)}`
    + `&$orderby=receivedDateTime%20desc&$select=from,receivedDateTime,inferenceClassification&$top=50`;
  const data = await msFetch(env, path, tokens.access_token);
  const list = (data.value || []).filter((m) => m.inferenceClassification !== 'other'); // skip the "Other" tab
  return {
    count: list.length,
    messages: list.map((m) => ({ at: Date.parse(m.receivedDateTime) || 0, from: cleanName(m.from?.emailAddress?.name || (m.from?.emailAddress?.address || '').split('@')[0]) })),
  };
}

async function msToken(env, params) {
  const res = await fetch(`${msLogin(env)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: MS_SCOPE, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const desc = String(data.error_description || data.error || `status ${res.status}`).split('\n')[0];
    if (data.error === 'invalid_grant') throw new Error('Sign-in expired');
    throw new Error(desc.slice(0, 160));
  }
  return data;
}

async function msFetch(env, path, accessToken) {
  const res = await fetch(msGraph(env) + path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message?.slice(0, 160) || `Microsoft Graph error ${res.status}`);
  return data;
}

function resultPage(ok, msg) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Life Dashboard</title><style>body{font-family:system-ui,sans-serif;background:#fff;color:#1b1b1b;margin:0;padding:48px 20px;text-align:center}
.box{max-width:420px;margin:auto}h1{font-size:1.4rem}p{line-height:1.5;color:#444}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#1b1b1b;color:#fff;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}p{color:#bbb}a{background:#eee;color:#121212}}</style></head>
<body><div class="box"><div style="font-size:3rem">${ok ? '✅' : '⚠️'}</div><h1>${ok ? 'Email connected' : 'Not connected'}</h1><p>${esc(msg)}</p>
<a href="https://preissergael-ctrl.github.io/life-dashboard/#settings">Back to Life Dashboard</a></div></body></html>`;
}

/* ---------------- Sender names ---------------- */

// "From: =?UTF-8?Q?Prof=2E_Ruiz?= <ruiz@tec.mx>" -> "Prof. Ruiz"
export function senderName(header) {
  const raw = header.replace(/\r?\n[ \t]+/g, ' ').match(/^From:\s*(.*)$/im)?.[1]?.trim() || '';
  const value = decodeWords(raw);
  const named = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]*)>/);
  if (named && named[1].trim()) return cleanName(named[1]);
  const addr = (named?.[2] || value).trim();
  return cleanName(addr.split('@')[0]);
}

function cleanName(name) {
  name = name.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

function decodeWords(s) {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_m, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toLowerCase() === 'b') bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      else {
        const t = text.replace(/_/g, ' ');
        const out = [];
        for (let i = 0; i < t.length; i++) {
          if (t[i] === '=' && /^[0-9a-f]{2}$/i.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
          else out.push(t.charCodeAt(i));
        }
        bytes = new Uint8Array(out);
      }
      try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
    } catch { return text; }
  });
}

/* ---------------- Encryption at rest ---------------- */

async function mailKey(env) {
  if (!env.MAIL_KEY) fail('MAIL_KEY secret is missing on the server', 500);
  return crypto.subtle.importKey('raw', b64urlDecode(env.MAIL_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await mailKey(env), new TextEncoder().encode(text));
  return b64url(concat(iv, new Uint8Array(ct)));
}

async function decrypt(env, data, aad) {
  const bytes = b64urlDecode(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(aad) }, await mailKey(env), bytes.subarray(12));
  return new TextDecoder().decode(pt);
}

/* ---------------- Helpers ---------------- */

function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timed out')), ms); })]).finally(() => clearTimeout(t));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
