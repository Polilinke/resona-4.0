// Internet Archive music search and direct-file playback for Resona.
(() => {
  const API = 'https://archive.org';
  const SEARCH_LIMIT = 12;
  const AUDIO_EXTENSIONS = ['mp3','m4a','ogg','opus','flac','wav','aac'];

  function cleanCreator(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(', ');
    return value || 'Internet Archive';
  }

  function isPlayableFile(file) {
    const name = String(file.name || '').toLowerCase();
    const ext = name.split('.').pop();
    return AUDIO_EXTENSIONS.includes(ext) && !name.includes('__ia_thumb');
  }

  function chooseAudioFile(files) {
    const candidates = (files || []).filter(isPlayableFile);
    const priority = ['mp3','m4a','ogg','opus','aac','flac','wav'];
    candidates.sort((a,b) => priority.indexOf(String(a.name).split('.').pop().toLowerCase()) - priority.indexOf(String(b.name).split('.').pop().toLowerCase()));
    return candidates[0] || null;
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Internet Archive returned HTTP ' + response.status + '.');
    return response.json();
  }

  async function search(query) {
    const phrase = String(query || '').trim().replace(/["\\]/g, ' ').replace(/\s+/g, ' ');
    if (phrase.length < 2) return [];
    const params = new URLSearchParams();
    params.set('q', 'mediatype:audio AND (title:"' + phrase + '" OR creator:"' + phrase + '")');
    ['identifier','title','creator','year','downloads'].forEach(field => params.append('fl[]', field));
    params.set('rows', String(SEARCH_LIMIT));
    params.set('page', '1');
    params.set('output', 'json');
    params.append('sort[]', 'downloads desc');

    const data = await fetchJson(API + '/advancedsearch.php?' + params.toString());
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    const tracks = await Promise.all(docs.map(async item => {
      try {
        const meta = await fetchJson(API + '/metadata/' + encodeURIComponent(item.identifier));
        const file = chooseAudioFile(meta.files);
        if (!file) return null;
        const title = item.title || (meta.metadata && meta.metadata.title) || item.identifier;
        const creator = cleanCreator(item.creator || (meta.metadata && meta.metadata.creator));
        return {
          id: 'archive-' + item.identifier,
          archiveId: item.identifier,
          source: 'archive',
          title: String(title),
          artist: String(creator),
          thumbnail: API + '/services/img/' + encodeURIComponent(item.identifier),
          duration: Number((meta.metadata && (meta.metadata.runtime || meta.metadata.length)) || file.length || 0),
          streamUrl: API + '/download/' + encodeURIComponent(item.identifier) + '/' + file.name.split('/').map(encodeURIComponent).join('/'),
          permalink: API + '/details/' + encodeURIComponent(item.identifier),
          genre: 'Archive',
          isDownloadable: false
        };
      } catch (_) { return null; }
    }));
    return tracks.filter(Boolean);
  }

  window.InternetArchiveAPI = { search };
})();
