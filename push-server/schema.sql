-- Phones that turned on notifications
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,   -- SHA-256 of the device's secret token
  endpoint TEXT NOT NULL,     -- push address given by the phone's browser
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
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
