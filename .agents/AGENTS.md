# QR-Scan Project Memory

## Projects & deployment
- This project: QR-Scan — local `D:\D\project\qr scan`, GitHub `AISHWARYJHAVERI/QR-Scan`, working branch `master`.
- Companion project: QR-App — local `D:\D\project\qr app`, GitHub `AISHWARYJHAVERI/QR-App`.
- QR-Scan frontend and API (`/api/*`) are deployed on Vercel at `qr-scan-rho-green.vercel.app`.
- QR-App frontend/API are deployed at `qr-app-rust.vercel.app` / `qr-app-api.vercel.app`.
- Vercel env vars: `MONGODB_URI`, `JWT_SECRET`, `QR_APP_API_URL`. Never commit `.env`, secrets, or `cookies.txt`.

## Branch rules
- QR-Scan: normal changes/hotfixes go directly to `master`; commit and push so Vercel auto-deploys.
- QR-App: dedicated features go to dedicated branches (e.g. `feature/scan-analytics`); general fixes/hotfixes go to `main`. Do not push QR-App feature work to `main`.

## Stack & build
- npm is the only package manager; `yarn.lock` was deleted, keep `package-lock.json`.
- `server/package.json` uses `"type": "commonjs"`.
- Vercel build command is `npm run build` (builds worker + app), never `npm run build:app` alone.
- Scanner: native `BarcodeDetector` primary, ZXing WASM (`zxing-wasm`) worker fallback. Do not force-disable `BarcodeDetector`. Target ~60 fps.

## Data flow
- Two separate MongoDB databases: `qr_scanner` (this app) and `QRAPP` (QR-App).
- Flow: camera/file scan → `POST /api/scans` → local MongoDB → async POST to QR-App API → QR-App analytics dashboard.
- Time slots: `morning`, `afternoon`, `evening`, `night`, derived from scan hour.
- Dedup rule: unique `{ qrValue, scannedBy, timeSlot }`. Same QR + same user + same slot is blocked; anonymous duplicate returns the existing record.

## QR format rules
- App QR format 1: `{"name":"...","mobile":"...","city":"..."}`.
- App QR format 2: `{"app":"QRAPP","type":"U","name":"...","phone":"..."}`.
- Both app formats auto-register, show the name on the dashboard, and map `phone` → `mobile`.
- Plain-text / other QR values: show raw value in the green result area with a confirmation popup; if confirmed, store as `Plain QR` with `scannedBy: "anonymous"`. Never silently drop a scanned value.
- `scannedBy`: logged-in user id for signed-in scans; parsed QR name for app QRs; `anonymous` otherwise.

## Analytics & performance
- Dashboard uses the merged `GET /api/scans/dashboard` endpoint (one round trip).
- Analytics use `distinct()` + `countDocuments()` instead of loading all documents; keep aggregation fast.
- Keep-alive: ping `/api/health` every ~4 minutes; Vercel cron `*/5 * * * *` handles cold starts.
- Search input: 400 ms debounce + `AbortController` for stale requests; auth user cache ~5 minutes.
- `node-cron` is a runtime dependency; `@rollup/plugin-node-resolve` is a dev dependency.

## UI rules
- Mobile: no `backdrop-filter: blur()` on panels (causes white flash while scrolling); use `100dvh`, `overscroll-behavior: none`, GPU-friendly animations.
- Hamburger menu: single click, popup stays inside the frame, shifted right with left spacing; no whole-page blur when open.
- Auth UI: hide the login button when logged in on every viewport; analytics visible only to signed-in users.
- Admin: first registered user is the admin; admin alone can grant admin access to another user from a dedicated section; admin panel visible only to admins.

## Scan window / control page (added 2026-11-20)
- Strict scan schedule enforced server-side in `POST /api/scans` using `server/models/Control.js`. Date/time computed in `Asia/Kolkata` (IST) via `Intl.DateTimeFormat`, never server UTC.
- Settings live in `scanSettings` (`key: 'main'`): `enabled`, `startDate`, `endDate` (inclusive YYYY-MM-DD), `slots` (4 entries: `morning` 09:00–12:00, `afternoon` 13:00–16:00, `evening` 17:00–20:00, `night` 21:00–23:00, each with `enabled`), `timezone`, `permissionMode` (`common-only` | `everyone`), `permissions`. Defaults: `2026-11-21` → `2026-11-21`, all four slots enabled, `common-only`. Legacy `date`/`startTime`/`endTime` docs migrate on read.
- A scan is allowed only when today (IST) is inside the date range AND the current time is inside an enabled slot. The matched slot key becomes `timeSlot` for analytics. Admin overrides outside all slots fall back to the default hour mapping (9/13/17/21).
- Dedup key is now `{ qrValue, scannedBy, scanDate, timeSlot }` where `scanDate` is IST `YYYY-MM-DD`; the old 3-field unique index is dropped on startup so the same QR/user can scan once per slot per day.
- Outside window: common users get HTTP 403 `code: SCAN_WINDOW_CLOSED` with allowed dates/slots in the message (toast + red text in result box, no dashboard row). Override holders (control account, `scanOverride`, or admins in `common-only` mode) get a non-blocking warning toast; scan still saves. `everyone` mode restricts admins unless they have `scanOverride`.
- Control account lives in `controlCredentials` collection; username `aishwary`. Password stored as bcrypt hash only — plaintext must NEVER be written to code, DB as plaintext, or memory files. Settings page shows ID + masked dots and allows setting a new password without current-password confirmation.
- Login (`POST /api/auth/login`) accepts username OR email; special control credentials are checked FIRST with fallthrough to normal user DB, so a normal user with the same username/different password still logs in normally. Login response includes `redirect: '/control.html'` for the control account.
- New standalone page `main/control.html` → deploys at `/control.html` (added to Vite multi-page build). It imports `./index.css` to share the main app's theme, fonts, glass cards, buttons, Lucide icons and floating toast notifications; no sidebar/menu, only a Back link. Three cards: credentials, scan schedule, admin permissions. APIs: `GET/PUT /api/control/settings`, `PUT /api/control/password` (all require `settingsAccess` token).
- Per-admin permissions: two separate toggles in `scanSettings.permissions[userId]` — `scanOverride` (scan outside window) and `pageAccess` (open `/control.html`). List shows only `isAdmin` users. `auth.js` `resolveUser` attaches both flags from DB to `req.user`; changing permissions invalidates that user's cache entry.
- Frontend: `registerScan(qrValue, resultLabel)` (indexed from camera/file/plain-QR paths) shows the 403 message in the result box and hides copy/open buttons. Verified `npm run build` + `node -c` on all backend files.
- Login field `login-email` MUST stay `type="text"` with label **"Username or Email"** — `type="email"` makes the browser reject plain `aishwary` before submitting. Control account logs in with plain text `aishwary`; normal users log in with their email. Frontend sends the value as `username` in the login body; backend resolves `email` first, then `username`.
- The "Admin Sign In / Admin username not found." panel belongs to the **QR-App** project (`D:\D\project\qr app\src\App.jsx`, json-server `/admins`), NOT QR-Scan. The control account `aishwary` only exists in QR-Scan. Correct URL for it: `qr-scan-rho-green.vercel.app`.
- `vercel.json` MUST use `routes` with `{ "handle": "filesystem" }` before the SPA fallback, otherwise Vercel serves `/index.html` at `/control.html`. A regex lookahead exclusion in `rewrites` does NOT work.

## History notes
- Scanner worker moved from jsQR to ZXing WASM via `build-worker.mjs` + `src/worker.ts`; the generated worker is bundled, not a bare import.
- Analytics loading issues were fixed with cached collection + aggregation; keep this pattern when touching `server/models/Scan.js`.
