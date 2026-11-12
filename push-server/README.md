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
