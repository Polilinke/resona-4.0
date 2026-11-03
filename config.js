// Public runtime configuration for Resona.
// Cloudflare Pages uses the same-origin /api/youtube route automatically.
// For Electron builds, set apiBaseUrl to your deployed HTTPS Pages domain.
// This file must never contain API keys, passwords, or other secrets.
window.RESONA_CONFIG = Object.freeze({
  apiBaseUrl: ''
});
