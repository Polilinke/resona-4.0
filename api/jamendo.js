const API = 'https://api.jamendo.com/v3.0';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(status).json(body);
}

function safeId(value) {
  const id = String(value || '');
  return /^\\d{1,15}$/.test(id) ? id : '';
}

function mapTrack(track) {
  const id = safeId(track.id);
  if (!id) return null;
  const licenseUrl = String(track.license_ccurl || '');
  const licenseName = licenseUrl ? licenseUrl.split('/').filter(Boolean).slice(-2).join(' ') : 'Creative Commons licence';
  return {
    id: 'jamendo-' + id,
    jamendoId: id,
    source: 'jamendo',
    title: String(track.name || 'Untitled track'),
    artist: String(track.artist_name || 'Unknown artist'),
    thumbnail: String(track.album_image || track.image || ''),
    duration: Number(track.duration) || 0,
    streamUrl: '/api/jamendo?action=stream&id=' + encodeURIComponent(id),
    permalink: String(track.shareurl || 'https://www.jamendo.com/track/' + id),
    licenseUrl,
    licenseName,
    isDownloadable: false
  };
}

async function streamTrack(req, res, clientId, id) {
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const url = new URL(API + '/tracks/file/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('id', id);
  url.searchParams.set('action', 'stream');
  url.searchParams.set('audioformat', 'mp32');

  const upstream = await fetch(url.toString(), { headers, redirect: 'follow' });
  if (!upstream.ok || !upstream.body) {
    return send(res, upstream.status || 502, { error: 'Jamendo could not provide this audio stream.' });
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  const length = upstream.headers.get('content-length');
  const range = upstream.headers.get('content-range');
  if (length) res.setHeader('Content-Length', length);
  if (range) res.setHeader('Content-Range', range);
  if (req.method === 'HEAD') return res.end();

  try {
    for await (const chunk of upstream.body) {
      if (res.destroyed) break;
      if (!res.write(Buffer.from(chunk))) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
    if (!res.destroyed) res.end();
  } catch (error) {
    if (!res.headersSent) return send(res, 502, { error: 'Jamendo audio streaming failed.' });
    if (!res.destroyed) res.end();
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Range');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    return send(res, 503, { error: 'Jamendo is not configured yet. Add JAMENDO_CLIENT_ID to Vercel Environment Variables.' });
  }

  const action = String(req.query.action || 'search');
  if (action === 'stream') {
    const id = safeId(req.query.id);
    if (!id) return send(res, 400, { error: 'A valid Jamendo track ID is required.' });
    try {
      return await streamTrack(req, res, clientId, id);
    } catch (error) {
      console.error('Resona Jamendo stream failed:', error);
      return send(res, 502, { error: 'Jamendo audio is temporarily unavailable.' });
    }
  }

  if (action !== 'search') return send(res, 400, { error: 'Unknown Jamendo action.' });
  const query = String(req.query.q || '').trim().slice(0, 100);
  if (query.length < 2) return send(res, 400, { error: 'Search must be at least 2 characters.' });

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return send(res, 200, cached.body);

  const url = new URL(API + '/tracks/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '25');
  url.searchParams.set('search', query);
  url.searchParams.set('include', 'licenses');
  url.searchParams.set('audioformat', 'mp32');

  try {
    const upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || data?.headers?.status !== 'success') {
      return send(res, upstream.status || 502, { error: data?.headers?.error_message || 'Jamendo search failed.' });
    }
    const items = (Array.isArray(data.results) ? data.results : []).map(mapTrack).filter(Boolean);
    const body = { items };
    cache.set(key, { body, expiresAt: Date.now() + CACHE_MS });
    return send(res, 200, body);
  } catch (error) {
    console.error('Resona Jamendo search failed:', error);
    return send(res, 502, { error: 'Jamendo search is temporarily unavailable.' });
  }
}
