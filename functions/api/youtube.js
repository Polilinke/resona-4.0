const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const CACHE_SECONDS = 300;
const COOLDOWN_MS = 5000;
const DAILY_LIMIT = 30;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type'
    }
  });
}

function pacificDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

async function hashIp(ip) {
  const bytes = new TextEncoder().encode(ip || 'unknown');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
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

async function getCached(db, key, now) {
  const row = await db.prepare(
    'SELECT response_json, expires_at FROM api_cache WHERE cache_key = ?1'
  ).bind(key).first();
  if (!row || row.expires_at <= now) return null;
  try { return JSON.parse(row.response_json); } catch { return null; }
}

async function setCached(db, key, body, now) {
  await db.prepare(
    'INSERT INTO api_cache (cache_key, response_json, expires_at) VALUES (?1, ?2, ?3) ' +
    'ON CONFLICT(cache_key) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at'
  ).bind(key, JSON.stringify(body), now + CACHE_SECONDS * 1000).run();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'Search service storage is not configured.' }, 503);
  const key = env.YOUTUBE_API_KEY;
  if (!key) return json({ error: 'Search service is not configured.' }, 503);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const now = Date.now();
  let cacheKey;
  let providerUrl;

  if (action === 'search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    if (q.length < 3) return json({ error: 'Search must be at least 3 characters.' }, 400);
    cacheKey = 's:' + q.toLowerCase();
    providerUrl = new URL(SEARCH_URL);
    for (const [name, value] of Object.entries({
      part: 'snippet', type: 'video', videoCategoryId: '10',
      maxResults: '20', q, key
    })) providerUrl.searchParams.set(name, value);
  } else if (action === 'popular') {
    const requested = String(url.searchParams.get('region') || 'IN').toUpperCase();
    const region = /^[A-Z]{2}$/.test(requested) ? requested : 'IN';
    cacheKey = 'p:' + region;
    providerUrl = new URL(VIDEOS_URL);
    for (const [name, value] of Object.entries({
      part: 'snippet', chart: 'mostPopular', videoCategoryId: '10',
      regionCode: region, maxResults: '20', key
    })) providerUrl.searchParams.set(name, value);
  } else {
    return json({ error: 'Unknown search action.' }, 400);
  }

  try {
    const cached = await getCached(env.DB, cacheKey, now);
    if (cached) return json(cached);

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hashIp(clientIp);
    const day = pacificDay();

    // One atomic D1 upsert enforces both the cooldown and daily per-IP cap
    // across Cloudflare instances. Only a successful fresh request consumes a slot.
    const allowed = await env.DB.prepare(
      'INSERT INTO api_usage (ip_hash, day, request_count, last_request) VALUES (?1, ?2, 1, ?3) ' +
      'ON CONFLICT(ip_hash, day) DO UPDATE SET request_count = request_count + 1, last_request = excluded.last_request ' +
      'WHERE request_count < ?4 AND last_request <= ?3 - ?5 RETURNING request_count'
    ).bind(ipHash, day, now, DAILY_LIMIT, COOLDOWN_MS).first();

    if (!allowed) {
      const usage = await env.DB.prepare(
        'SELECT request_count, last_request FROM api_usage WHERE ip_hash = ?1 AND day = ?2'
      ).bind(ipHash, day).first();
      if (usage && usage.request_count >= DAILY_LIMIT) {
        return json({ error: 'Daily search limit reached for this connection. Try again tomorrow.' }, 429);
      }
      return json({ error: 'Please wait 5 seconds before another fresh search.' }, 429);
    }

    const upstream = await fetch(providerUrl.toString(), {
      headers: { 'accept': 'application/json' }
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const reason = data?.error?.errors?.[0]?.reason || '';
      if (upstream.status === 403 && /quota/i.test(reason + (data?.error?.message || ''))) {
        return json({ code: 'QUOTA_EXHAUSTED', error: 'Resona search has reached its shared daily YouTube quota.' }, 503);
      }
      return json({ error: data?.error?.message || 'YouTube search failed.' }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }

    const body = { items: mapItems(data.items) };
    await setCached(env.DB, cacheKey, body, now);
    return json(body);
  } catch (error) {
    console.error('YouTube API function failed:', error);
    return json({ error: 'Search service is temporarily unavailable.' }, 502);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'allow': 'GET, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type',
      'cache-control': 'no-store'
    }});
  }
  if (context.request.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, 405);
  }
  return onRequestGet(context);
}
