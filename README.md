# Resona

Resona is a browser-based music discovery and playback interface, with an optional Electron desktop shell. It uses the official YouTube IFrame Player for playback and the YouTube Data API v3 for search and popular tracks. It does not download or extract YouTube audio.

## Cloudflare Pages deployment

The browser edition is designed to deploy to **Cloudflare Pages**. The repository root is the Pages project root; there is no build step because the frontend is plain HTML, CSS and JavaScript.

### 1. Create the D1 database

1. In the Cloudflare dashboard, open **Workers & Pages → D1 SQL Database**.
2. Create a database named `resona-production`.
3. Open the database and run the SQL in `migrations/0001_initial.sql`.
4. Copy the database ID into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

The D1 binding name must remain `DB`. The Pages Function uses it for persistent per-IP rate limits and short-lived search caching.

### 2. Connect Pages to GitHub

1. Open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select `Polilinke/resona-4.0`.
3. Set the production branch to `main`.
4. Set **Build command** to blank / none.
5. Set **Build output directory** to `.` (the repository root).
6. Deploy.

Cloudflare Pages automatically discovers the API route at `functions/api/youtube.js`, which serves `/api/youtube`.

### 3. Add the YouTube API key

In the Pages project, open **Settings → Variables and Secrets → Add** and create:

- Name: `YOUTUBE_API_KEY`
- Value: your Google Cloud YouTube Data API v3 key
- Type: secret / encrypted
- Environment: Production (and Preview only if you want preview deployments to search)

Never put the real key in frontend JavaScript, HTML, GitHub, or an Electron package. Keep `.env` local and untracked.

### 4. Verify the deployment

After deployment, test:

- `https://YOUR-PAGES-DOMAIN/api/youtube?action=popular&region=IN`
- `https://YOUR-PAGES-DOMAIN/api/youtube?action=search&q=daft%20punk`

A successful response is JSON containing an `items` array. A missing secret or D1 binding returns a service-configuration error rather than exposing credentials.

## Cloudflare configuration

- `wrangler.toml`: Pages output directory and D1 binding.
- `functions/api/youtube.js`: server-side YouTube API proxy.
- `migrations/0001_initial.sql`: persistent D1 tables.
- `js/youtube.js`: same-origin frontend API client.

The API uses D1-backed limits: a five-second fresh-request cooldown and up to 30 fresh requests per IP per Pacific calendar day. IP addresses are SHA-256 hashed before storage. Successful responses are cached in D1 for five minutes. These are abuse-reduction guardrails, not a guarantee against distributed abuse or exhaustion of Google's project quota. Set Google Cloud API restrictions and quota alerts as well.

## Browser data and privacy

The browser edition stores the user's library, playlists, queue, history, settings and selected custom MP4 background locally in that browser using localStorage / IndexedDB. These are not synced between devices and are not automatically shared with other users. The current Listening Rooms view is a placeholder, not a functioning multiplayer feature.

## Local development

Serve the repository through Cloudflare Pages local development so that the `/api/youtube` Function and D1 binding are available. Configure the local secret with Wrangler's local secret workflow; do not commit it. The frontend is static and does not need a bundler.

## Electron desktop edition

The Electron shell remains in the repository, but the Cloudflare Pages API is same-origin and is intended for the hosted browser edition. A packaged Electron app opened from `file://` cannot call the relative `/api/youtube` route. Before distributing Electron builds, add a configurable HTTPS API base URL and point it at the deployed Pages domain; do not embed the YouTube API key in the app. The current repository migration does not claim that this desktop API endpoint has been configured.

## Known limitations

- The YouTube embedded player does not expose decoded audio to the page. The visualizer is decorative; a real equalizer or audio-reactive visualizer needs a supported direct audio source.
- Listening Rooms need authentication and a realtime backend before they can be enabled.
- JARVIS integration is not enabled. Any future assistant API must be server-side, authenticated and rate-limited; never expose a Gemini key or a user's local JARVIS service to the public browser.
- Google controls the authoritative YouTube API quota. Cached responses reduce repeat requests but do not change Google's quota rules.
