// Audius read-only search and streaming adapter for Resona.
(() => {
  const BASES = [
    'https://api.audius.co/v1',
    'https://discoveryprovider.audius.co/v1'
  ];
  const APP_NAME = 'Resona';
  let activeBase = BASES[0];

  function endpoint(path) {
    const url = new URL(activeBase + path);
    url.searchParams.set('app_name', APP_NAME);
    return url.toString();
  }

  async function request(path) {
    let lastError;
    for (const base of BASES) {
      activeBase = base;
      try {
        const response = await fetch(endpoint(path), { method: 'GET', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Audius returned HTTP ' + response.status);
        const payload = await response.json();
        if (payload && payload.error) throw new Error(payload.error);
        return payload && Array.isArray(payload.data) ? payload.data : [];
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError ? lastError.message : 'Audius is temporarily unavailable.');
  }

  function normalizeTrack(track) {
    const artwork = track.artwork || {};
    const artist = track.user || {};
    return {
      id: 'audius-' + String(track.id),
      audiusId: String(track.id),
      source: 'audius',
      title: track.title || 'Untitled track',
      artist: artist.name || artist.handle || 'Unknown artist',
      thumbnail: artwork['480x480'] || artwork['150x150'] || artwork['1000x1000'] || '',
      duration: Number(track.duration) || 0,
      permalink: track.permalink ? 'https://audius.co' + track.permalink : '',
      genre: track.genre || '',
      isDownloadable: !!track.is_downloadable
    };
  }

  async function search(query) {
    const params = new URLSearchParams({ query: query, limit: '25', sort_method: 'relevant' });
    const tracks = await request('/tracks/search?' + params.toString());
    return tracks.map(normalizeTrack);
  }

  async function getTrending(limit = 50) {
    const params = new URLSearchParams({ time: 'week', limit: String(limit) });
    const tracks = await request('/tracks/trending?' + params.toString());
    return tracks.map(normalizeTrack);
  }

  function getStreamUrl(trackId) {
    if (!trackId) throw new Error('This Audius track is missing its track ID.');
    const url = new URL(activeBase + '/tracks/' + encodeURIComponent(trackId) + '/stream');
    url.searchParams.set('app_name', APP_NAME);
    return url.toString();
  }

  window.AudiusAPI = { search, getTrending, getStreamUrl };
})();
