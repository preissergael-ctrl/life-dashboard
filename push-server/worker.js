// Life Dashboard reminder server (Cloudflare Worker + D1 database).
//
// The app sends its list of upcoming reminders here (POST /sync). A timer
// runs every minute, finds reminders that are due and sends them to the
// phone as Web Push notifications. No libraries: the push encryption
// (RFC 8291) and VAPID signing (RFC 8292) use the built-in Web Crypto API.
//
// Secret (set with `wrangler secret put`): VAPID_PRIVATE_JWK
// Vars (wrangler.toml): ALLOWED_ORIGINS, VAPID_SUBJECT, VAPID_PUBLIC

const MAX_REMINDERS = 500;   // per device
const MAX_DEVICES = 50;      // whole server (it's a personal app)
const STALE_MS = 6 * 3600e3; // reminders more than 6h late are dropped, not sent

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const { pathname } = new URL(req.url);
    if (req.method !== 'POST') return json({ ok: true, service: 'life-dashboard-push' });
    if (!allowed.includes(origin)) return json({ error: 'origin not allowed' }, 403);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    try {
      if (pathname === '/sync') return json(await sync(env, body));
      if (pathname === '/test') return json(await test(env, body));
      if (pathname === '/unregister') return json(await unregister(env, body));
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, err.status || 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};

/* ---------------- API ---------------- */

function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }

function checkSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || s.endpoint.length > 1000) fail('bad subscription');
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') fail('bad subscription keys');
  return s;
}

async function authDevice(env, device, token) {
  if (typeof device !== 'string' || typeof token !== 'string') return null;
  const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(device).first();
  if (!row || row.token_hash !== await sha256(token)) return null;
  return row;
}

// Body: { device?, token?, subscription, reminders: [{ id, at, title, body }] }
// Replaces this device's reminders with the list sent. Creates the device on first call.
async function sync(env, body) {
  const sub = checkSubscription(body.subscription);
  if (!Array.isArray(body.reminders) || body.reminders.length > MAX_REMINDERS) fail('bad reminders');

  let device = await authDevice(env, body.device, body.token);
  let token = body.token;
  const now = Date.now();
  if (!device) {
    const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first()).n;
    if (count >= MAX_DEVICES) fail('server full', 503);
    device = { id: crypto.randomUUID() };
    token = b64url(crypto.getRandomValues(new Uint8Array(24)));
    await env.DB.prepare('INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(device.id, await sha256(token), sub.endpoint, sub.keys.p256dh, sub.keys.auth, now, now).run();
  } else {
    await env.DB.prepare('UPDATE devices SET endpoint = ?, p256dh = ?, auth = ?, last_seen = ? WHERE id = ?')
      .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, now, device.id).run();
  }

  const rows = body.reminders
    .filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.at) && r.at > now - 60e3 && typeof r.title === 'string')
    .map((r) => [r.id.slice(0, 80), Math.round(r.at), r.title.slice(0, 200), String(r.body || '').slice(0, 400)]);

  const stmts = [env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(device.id)];
  for (const [rid, at, title, text] of rows) {
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO reminders (device_id, rid, fire_at, title, body) VALUES (?, ?, ?, ?, ?)')
      .bind(device.id, rid, at, title, text));
  }
  await env.DB.batch(stmts);
  return { device: device.id, token, scheduled: rows.length };
}

// Sends a notification right away so the user can check it works.
async function test(env, body) {
  const device = await authDevice(env, body.device, body.token);
  if (!device) fail('unknown device', 401);
  const res = await sendPush(env, device, { title: 'Life Dashboard', body: 'Notifications are working 🎉', tag: 'test' });
  if (!res.ok) fail(`push service said ${res.status}`, 502);
  return { sent: true };
}

async function unregister(env, body) {
  const device = await authDevice(env, body.device, body.token);
  if (!device) return { removed: false };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(device.id),
    env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(device.id),
  ]);
  return { removed: true };
}

/* ---------------- Timer: send what's due ---------------- */

async function sendDue(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT r.device_id, r.rid, r.fire_at, r.title, r.body, d.endpoint, d.p256dh, d.auth
       FROM reminders r JOIN devices d ON d.id = r.device_id
      WHERE r.fire_at <= ? ORDER BY r.fire_at LIMIT 100`).bind(now).all();
  if (results.length) console.log('due:', results.length);

  for (const r of results) {
    await env.DB.prepare('DELETE FROM reminders WHERE device_id = ? AND rid = ?').bind(r.device_id, r.rid).run();
    if (r.fire_at < now - STALE_MS) continue;
    let res;
    try {
      res = await sendPush(env, r, { title: r.title, body: r.body, tag: r.rid });
    } catch (err) {
      console.log('push failed', r.rid, err.message); // network hiccup: skip this one, keep going
      continue;
    }
    console.log('sent', r.rid, res.status);
    if (res.status === 404 || res.status === 410) {
      // The phone unsubscribed (app uninstalled / permission removed): forget it
      await env.DB.batch([
        env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(r.device_id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(r.device_id),
      ]);
    }
  }
}

/* ---------------- Web Push ---------------- */

async function sendPush(env, target, message) {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  const body = await encryptPayload(payload, b64urlDecode(target.p256dh), b64urlDecode(target.auth));
  const jwt = await vapidJWT(env, new URL(target.endpoint).origin);
  return fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '21600',
      Urgency: 'high',
    },
    body,
  });
}

// RFC 8292: a short-lived signed token proving the push comes from us.
async function vapidJWT(env, audience) {
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT,
  })}`;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

// RFC 8291 (aes128gcm): encrypt the message so only that phone can read it.
export async function encryptPayload(plaintext, uaPublic, authSecret) {
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const te = new TextEncoder();
  const ikm = await hkdf(authSecret, ecdhSecret, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02 = last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/* ---------------- Helpers ---------------- */

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

async function sha256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
