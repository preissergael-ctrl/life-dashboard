# Reminder server

A tiny Cloudflare Worker (free plan) that sends Life Dashboard's reminder
notifications. The app sends it the list of upcoming reminders; every minute
it sends the ones that are due as Web Push notifications.

## Setup (already done once)

```sh
cd push-server
npx wrangler login
npx wrangler d1 create life-dashboard-push        # put the id in wrangler.toml
npx wrangler d1 execute life-dashboard-push --remote --file=schema.sql
npx wrangler secret put VAPID_PRIVATE_JWK          # paste the private key JSON
npx wrangler deploy
```

`VAPID_PUBLIC` in wrangler.toml must match `PUSH_PUBLIC_KEY` in `../push.js`.
If you ever make new keys, every phone has to turn notifications off and on again.

## Email in the morning summary (mail.js)

The daily summary can also say how many emails came in over the last 24 hours and who sent them.
Accounts are linked from the app (Settings → Notifications). Inboxes are only read, never changed.

- `MAIL_KEY` secret (random 32 bytes, base64url) encrypts stored app passwords / sign-in tokens:
  `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put MAIL_KEY`
- **Gmail**: IMAP with a Google app password. Works with no extra setup.
- **Microsoft (Outlook.com, Hotmail, school Microsoft 365)**: needs an app registration in Microsoft Entra
  (supported accounts: any organization + personal Microsoft accounts; Web redirect URI
  `https://<worker>/mail/ms-callback`; API permissions: `User.Read`, `Mail.Read`, `offline_access`).
  Put its Application (client) ID in `MS_CLIENT_ID` in wrangler.toml and its client secret as the
  `MS_CLIENT_SECRET` secret. School accounts may need an administrator to approve the app.
- Upgrading a database made before email support: run `migrate-001-mail.sql`, then `schema.sql`.
