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

1. Install Node.js and run `npm install` to install Wrangler locally through `npx` when needed.
2. Copy `.dev.vars.example` to `.dev.vars` and put your private YouTube key in `.dev.vars`. The real `.dev.vars` file is ignored by Git.
3. Apply the D1 schema locally with `npx wrangler d1 migrations apply resona-production --local`.
4. Run `npx wrangler pages dev .` from the repository root. The frontend and `/api/youtube` Function will be served together.

The frontend is static and does not need a bundler. Do not commit `.dev.vars` or paste a real key into chat.

## Electron desktop edition

The Electron shell remains available. The hosted browser edition uses the same-origin Pages API automatically. For an Electron build, edit the public `apiBaseUrl` value in `config.js` to your deployed HTTPS Pages domain (for example, `https://your-project.pages.dev`). This is a public endpoint URL, not a secret. The Pages Function allows cross-origin requests for this public search endpoint; never put the YouTube API key in the Electron package. The build configuration includes `config.js` and the built-in `assets/` folder.

## Known limitations

- The YouTube embedded player does not expose decoded audio to the page. The visualizer is decorative; a real equalizer or audio-reactive visualizer needs a supported direct audio source.
- Listening Rooms need authentication and a realtime backend before they can be enabled.
- JARVIS integration is not enabled. Any future assistant API must be server-side, authenticated and rate-limited; never expose a Gemini key or a user's local JARVIS service to the public browser.
- Google controls the authoritative YouTube API quota. Cached responses reduce repeat requests but do not change Google's quota rules.


## Resona accounts (initial implementation)

The browser edition now includes email/password account registration, email verification, sign-in, sign-out, and display-name editing. Passwords are hashed with PBKDF2 before storage; sessions are stored server-side in D1 and issued in secure, HTTP-only cookies.

### Configure account storage

1. Apply the new migration to the same D1 database:
   \`npx wrangler d1 migrations apply resona-production --remote\`
2. Configure a Resend account and verify the sender domain/address you intend to use.
3. In Cloudflare Pages → Settings → Variables and Secrets, add these **encrypted secrets**:
   - \`RESEND_API_KEY\`: your Resend API key.
   - \`RESONA_EMAIL_FROM\`: a sender such as \`Resona <accounts@your-verified-domain.example>\` (use an address/domain verified with Resend).
4. Redeploy the Pages project after adding the secrets.

The verification link expires after one hour. Account sessions expire after 30 days. The account API is same-origin and is currently intended for the hosted browser edition.

### Current account scope

This is the first authentication layer, not the complete cloud-library feature yet. Playlists, saved tracks, queue, history and settings still use device-local storage. They are **not yet synced to accounts**. Password reset, account deletion, profile pictures, Google sign-in, and Electron account sign-in are also not implemented yet. Do not announce cloud sync until the user-data API and migration are complete.
