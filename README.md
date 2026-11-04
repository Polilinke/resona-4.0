# Resona

Resona is a browser-based music discovery and playback interface, with an optional Electron desktop shell. It uses the official YouTube IFrame Player for playback and the YouTube Data API v3 for search and popular tracks. It does not download or extract YouTube audio.

## Hosting

The web app is deployed on **Vercel** and connected to this GitHub repository. Pushes to the production branch trigger automatic deployments.

### Vercel environment variable

In Vercel → Project → Settings → Environment Variables, configure:

- `YOUTUBE_API_KEY`: your Google Cloud YouTube Data API v3 key.

Keep this value private. Never place it in frontend JavaScript, HTML, GitHub, or an Electron package. Redeploy after changing environment variables.

The server-side YouTube API endpoint is `api/youtube.js`, served at `/api/youtube`.

## Browser data and privacy

The browser edition stores the user's library, playlists, queue, history, settings and selected custom MP4 background locally in that browser using localStorage / IndexedDB. These are not synced between devices and are not automatically shared with other users.

Account screens are present, but the account backend is being migrated to Supabase. Do not assume sign-in, registration, or cloud library sync is available until that migration is complete.

## Local development

The frontend is plain HTML, CSS and JavaScript and does not require a bundler. Open `index.html` through a local static server for browser testing.

For the optional Electron desktop edition, install dependencies with `npm install` and start it with `npm start`.

## Electron desktop edition

The Electron shell remains available. The hosted browser edition uses the same-origin Vercel API automatically. For an Electron build, set the public `apiBaseUrl` value in `config.js` to your deployed HTTPS Vercel domain. This is a public endpoint URL, not a secret. Never put the YouTube API key in the Electron package.

## Known limitations

- The YouTube embedded player does not expose decoded audio to the page. The visualizer is decorative; a real equalizer or audio-reactive visualizer needs a supported direct audio source.
- Listening Rooms need authentication and a realtime backend before they can be enabled.
- Playlists, saved tracks, queue, history and settings are currently device-local and are not synced to accounts.
- Password reset, account deletion, profile pictures, Google sign-in, and Electron account sign-in are not yet implemented.
- JARVIS integration is not enabled. Any future assistant API must be server-side, authenticated and rate-limited; never expose a Gemini key or a user's local JARVIS service to the public browser.
- Google controls the authoritative YouTube API quota. The server-side endpoint uses a small best-effort cache, but that does not change Google's quota rules.
