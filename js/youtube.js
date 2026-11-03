// Browser requests use the same-origin Cloudflare Pages Function.
// The YouTube API key stays in the server-side YOUTUBE_API_KEY secret.
const YouTubeAPI = (() => {
  class QuotaExhaustedError extends Error {}
  async function request(action, params = {}) {
    const url = new URL('/api/youtube', window.location.origin);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(body.error || 'Please wait before searching again.');
    if (res.status === 503 && body.code === 'QUOTA_EXHAUSTED') {
      throw new QuotaExhaustedError(body.error || 'The shared YouTube quota is exhausted.');
    }
    if (!res.ok) throw new Error(body.error || `Search service failed (${res.status}).`);
    return body;
  }
  async function search(query) {
    const body = await request('search', { q: query });
    return body.items || [];
  }
  async function fetchPopular(regionCode = 'IN') {
    const body = await request('popular', { region: regionCode });
    return body.items || [];
  }
  return { search, fetchPopular, QuotaExhaustedError };
})();