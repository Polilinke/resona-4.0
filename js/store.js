// Persistent local storage: settings, library, playlists, queue, history, quota and search cache.
// Everything lives in localStorage on this computer, so it survives app restarts.
const Store = (() => {
  const KEYS = {
    settings: 'jm.settings',
    library: 'jm.library',
    playlists: 'jm.playlists',
    quota: 'jm.quota',
    cache: 'jm.searchCache',
    queue: 'jm.queue',
    history: 'jm.history'
  };

  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // cache results for 24 hours
  const SEARCH_COST = 100;                  // YouTube search.list costs 100 quota units

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Could not read', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      if (['library', 'playlists', 'history'].includes(key)) {
        window.dispatchEvent(new CustomEvent('resona:data-changed', { detail: { key } }));
      }
    } catch (e) {
      console.error('Could not save', key, e);
    }
  }

  // Quota resets at midnight Pacific Time; the counter follows the Pacific date.
  function pacificDateKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }

  return {
    // ---- Settings ----
    getSettings() {
      return Object.assign({
        quotaThreshold: 8000,
        quotaLimit: 10000,
        theme: 'dark',
        accent: 'cyan',
        bgEnabled: false,
        albumBg: true,
        glass: false,
        windowSize: '1200x780'
      }, read(KEYS.settings, {}));
    },
    saveSettings(patch) {
      const next = Object.assign(this.getSettings(), patch);
      write(KEYS.settings, next);
      return next;
    },

    // ---- Quota ----
    getQuota() {
      const q = read(KEYS.quota, null);
      const today = pacificDateKey();
      if (!q || q.date !== today) return { date: today, used: 0 };
      return q;
    },
    addQuota(units) {
      const q = this.getQuota();
      q.used += units;
      write(KEYS.quota, q);
      return q;
    },
    resetQuota() {
      write(KEYS.quota, { date: pacificDateKey(), used: 0 });
    },
    searchCost() {
      return SEARCH_COST;
    },

    // ---- Search cache ----
    getCachedSearch(query) {
      const cache = read(KEYS.cache, {});
      const entry = cache[query.toLowerCase()];
      if (!entry) return null;
      if (Date.now() - entry.time > CACHE_TTL_MS) return null;
      return entry.results;
    },
    setCachedSearch(query, results) {
      const cache = read(KEYS.cache, {});
      cache[query.toLowerCase()] = { time: Date.now(), results };
      const keys = Object.keys(cache).sort((a, b) => cache[b].time - cache[a].time);
      const trimmed = {};
      keys.slice(0, 50).forEach(k => (trimmed[k] = cache[k]));
      write(KEYS.cache, trimmed);
    },
    clearCache() {
      write(KEYS.cache, {});
    },

    // ---- Library (saved tracks) ----
    getLibrary() {
      return read(KEYS.library, []);
    },
    isSaved(videoId) {
      return this.getLibrary().some(t => t.id === videoId);
    },
    saveTrack(track) {
      const lib = this.getLibrary();
      if (!lib.some(t => t.id === track.id)) {
        lib.unshift({ ...track, addedAt: Date.now() });
        write(KEYS.library, lib);
      }
      return lib;
    },
    removeTrack(videoId) {
      const lib = this.getLibrary().filter(t => t.id !== videoId);
      write(KEYS.library, lib);
      const pls = this.getPlaylists();
      pls.forEach(p => (p.tracks = p.tracks.filter(t => t.id !== videoId)));
      write(KEYS.playlists, pls);
      return lib;
    },

    // ---- Playlists ----
    getPlaylists() {
      return read(KEYS.playlists, []);
    },
    createPlaylist(name) {
      const pls = this.getPlaylists();
      const pl = { id: 'pl_' + Date.now().toString(36), name: name.trim(), tracks: [], createdAt: Date.now() };
      pls.push(pl);
      write(KEYS.playlists, pls);
      return pl;
    },
    renamePlaylist(id, name) {
      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === id);
      if (pl) pl.name = name.trim();
      write(KEYS.playlists, pls);
    },
    deletePlaylist(id) {
      write(KEYS.playlists, this.getPlaylists().filter(p => p.id !== id));
    },
    addToPlaylist(playlistId, track) {
      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl && !pl.tracks.some(t => t.id === track.id)) {
        pl.tracks.push(track);
        write(KEYS.playlists, pls);
      }
    },
    removeFromPlaylist(playlistId, videoId) {
      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl) pl.tracks = pl.tracks.filter(t => t.id !== videoId);
      write(KEYS.playlists, pls);
    },

    // ---- Queue ----
    getQueue() {
      return read(KEYS.queue, []);
    },
    setQueue(list) {
      write(KEYS.queue, list);
      return list;
    },

    // ---- History (songs played) ----
    getHistory() {
      return read(KEYS.history, []);
    },
    addToHistory(track) {
      const list = this.getHistory();
      list.unshift({ ...track, playedAt: Date.now() });
      write(KEYS.history, list.slice(0, 500));
    },
    clearHistory() {
      write(KEYS.history, []);
    },

    // ---- Backup ----
    exportAll() {
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        library: this.getLibrary(),
        playlists: this.getPlaylists(),
        queue: this.getQueue(),
        history: this.getHistory()
      };
    },
    importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Invalid backup file');
      if (Array.isArray(data.library)) write(KEYS.library, data.library);
      if (Array.isArray(data.playlists)) write(KEYS.playlists, data.playlists);
      if (Array.isArray(data.queue)) write(KEYS.queue, data.queue);
      if (Array.isArray(data.history)) write(KEYS.history, data.history);
    }
  };
})();
