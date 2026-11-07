// Jamendo search adapter. The Client ID stays server-side in Vercel.
(() => {
  async function search(query) {
    const params = new URLSearchParams({ action: 'search', q: String(query || '').trim() });
    const response = await fetch('/api/jamendo?' + params.toString(), {
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Jamendo search is unavailable.');
    return Array.isArray(payload.items) ? payload.items : [];
  }

  window.JamendoAPI = { search };
})();
