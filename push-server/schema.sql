-- Phones that turned on notifications
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,   -- SHA-256 of the device's secret token
  endpoint TEXT NOT NULL,     -- push address given by the phone's browser
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  hide_names INTEGER NOT NULL DEFAULT 0  -- hide task names / email senders in notifications
);

-- Upcoming notifications (the app replaces its list on every sync)
CREATE TABLE IF NOT EXISTS reminders (
  device_id TEXT NOT NULL,
  rid TEXT NOT NULL,
  fire_at INTEGER NOT NULL,   -- when to send, in ms since 1970 (UTC)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (device_id, rid)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (fire_at);

-- Email accounts shown in the morning summary (see mail.js)
CREATE TABLE IF NOT EXISTS mail_accounts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,         -- 'gmail' or 'microsoft'
  label TEXT NOT NULL,        -- "Gmail", "Tec", "Outlook"
  address TEXT NOT NULL,
  secret TEXT NOT NULL,       -- app password / refresh token, AES-GCM encrypted with MAIL_KEY
  created INTEGER NOT NULL,
  last_ok INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS mail_accounts_device ON mail_accounts (device_id);

-- Microsoft sign-ins in progress (deleted after 15 minutes)
CREATE TABLE IF NOT EXISTS mail_pending (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created INTEGER NOT NULL
);
