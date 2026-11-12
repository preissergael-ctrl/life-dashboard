# Life Dashboard

A to-do list and money tracker that installs on your phone as an app.
Plain HTML, CSS and JavaScript, so there's nothing to install or build.

## Run it on your computer
Double-click `start.cmd`, or run:

```
node tools/serve.mjs
```

Then open http://localhost:5173.

## Files
| File | What it is |
|---|---|
| `index.html` | The page layout (Home, Tasks, Money, Settings) |
| `styles.css` | Colors, fonts, spacing |
| `app.js` | Everything the app does: saving, tasks, money math |
| `pixels.js` | The pixel-art icons, drawn as 16x16 letter grids |
| `ai.js` | The "Ask" assistant: encrypts your API key and asks Claude to turn a sentence into actions |
| `vendor/anthropic-sdk.mjs` | The official Anthropic SDK (v1.8.0), bundled into one file |
| `sw.js` | Makes the app work offline |
| `manifest.webmanifest` | App name and icon for "Add to Home Screen" |
| `tools/` | Local server and icon generator (not part of the app) |

## Your data
Everything is saved in the browser on each device (localStorage). Use **Settings → Download backup** now and then.

The only thing ever sent anywhere is what you type in **Ask**, plus your open tasks' titles, which go to the Claude API
using your own API key. The key is encrypted with your password (PBKDF2 + AES-GCM) and is not included in backups.
