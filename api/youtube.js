const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

// Small per-instance cache to reduce repeat requests. This is intentionally
// best-effort; serverless instances do not share memory.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  return res.status(status).json(body);
}

function decodeHtml(value = '') {
  return value.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function mapItems(items = []) {
  return items.map(item => ({
    id: item.id?.videoId || item.id,
    title: decodeHtml(item.snippet?.title || ''),
    artist: decodeHtml(item.snippet?.channelTitle || ''),
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
  }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return send(res, 503, { error: 'Search service is not configured. Add YOUTUBE_API_KEY to Vercel Environment Variables.' });

  const action = String(req.query.action || '');
  let cacheKey;
  const providerUrl = new URL(action === 'popular' ? VIDEOS_URL : SEARCH_URL);

  if (action === 'search') {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 3) return send(res, 400, { error: 'Search must be at least 3 characters.' });
    cacheKey = 's:' + q.toLowerCase();
    for (const [name, value] of Object.entries({
      part: 'snippet', type: 'video', videoCategoryId: '10',
      maxResults: '20', q, key
    })) providerUrl.searchParams.set(name, value);
  } else if (action === 'popular') {
    const requested = String(req.query.region || 'IN').toUpperCase();
    const region = /^[A-Z]{2}$/.test(requested) ? requested : 'IN';
    cacheKey = 'p:' + region;
    for (const [name, value] of Object.entries({
      part: 'snippet', chart: 'mostPopular', videoCategoryId: '10',
      regionCode: region, maxResults: '20', key
    })) providerUrl.searchParams.set(name, value);
  } else {
    return send(res, 400, { error: 'Unknown search action.' });
  }

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return send(res, 200, cached.body);

  try {
    const upstream = await fetch(providerUrl.toString(), {
      headers: { accept: 'application/json' }
    });
    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const reason = data?.error?.errors?.[0]?.reason || '';
      if (upstream.status === 403 && /quota/i.test(reason + (data?.error?.message || ''))) {
        return send(res, 503, {
          code: 'QUOTA_EXHAUSTED',
          error: 'Resona search has reached its shared daily YouTube quota.'
        });
      }
      return send(res, upstream.status, {
        error: data?.error?.message || 'YouTube search failed.'
      });
    }

    const body = { items: mapItems(data.items) };
    cache.set(cacheKey, { body, expiresAt: Date.now() + CACHE_MS });
    return send(res, 200, body);
  } catch (error) {
    console.error('Resona YouTube API failed:', error);
    return send(res, 502, { error: 'Search service is temporarily unavailable.' });
  }
}
