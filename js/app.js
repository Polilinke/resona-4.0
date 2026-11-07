// Main application logic: UI wiring, search, embedded player, queue, library, playlists, history.
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    results: [],
    rawResults: [],
    isSearch: false,
    queue: Store.getQueue(),
    currentIndex: -1,
    currentTrack: null,
    audioMode: false,
    player: null,
    playerReady: false,
    pendingVideoId: null,
    pickerTrack: null,
    searchTimer: null,
    lastQuery: '',
    searchSource: 'youtube',
    searchRequestId: 0
  };

  // ---------- Settings, theme, accent, glass, album background ----------
  const DEFAULT_THEME_STUDIO = {
    themeAccent: '#67cfe0', themeSecondary: '#c88f62',
    glassTint: '#17313b', glassEdge: '#a6dce5', glassGlow: '#54c9df',
    glassReflection: '#ffffff', glassOpacity: 34, glassBlur: 32,
    glassSaturation: 185, glassEdgeStrength: 34
  };
  const THEME_PRESETS = {
    aurora: { themeAccent:'#67cfe0', themeSecondary:'#c88f62', glassTint:'#17313b', glassEdge:'#a6dce5', glassGlow:'#54c9df', glassReflection:'#ffffff', glassOpacity:34, glassBlur:32, glassSaturation:185, glassEdgeStrength:34 },
    ember: { themeAccent:'#f0a36f', themeSecondary:'#e16e58', glassTint:'#39251f', glassEdge:'#f0bd91', glassGlow:'#ef8c58', glassReflection:'#fff0df', glassOpacity:38, glassBlur:30, glassSaturation:175, glassEdgeStrength:42 },
    lavender: { themeAccent:'#b7a4f5', themeSecondary:'#e5a6c8', glassTint:'#28243d', glassEdge:'#d1c6ff', glassGlow:'#a995f2', glassReflection:'#f5edff', glassOpacity:36, glassBlur:34, glassSaturation:195, glassEdgeStrength:38 },
    mint: { themeAccent:'#83d8b3', themeSecondary:'#a9d7cf', glassTint:'#18352f', glassEdge:'#b2e9d4', glassGlow:'#70d9b0', glassReflection:'#effff8', glassOpacity:32, glassBlur:30, glassSaturation:190, glassEdgeStrength:32 }
  };
  function hexRgb(hex) {
    const clean = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#67cfe0';
    return [1, 3, 5].map(i => parseInt(clean.slice(i, i + 2), 16)).join(', ');
  }
  function applyThemeStudio(settings) {
    const s = Object.assign({}, DEFAULT_THEME_STUDIO, settings || {});
    const root = document.documentElement;
    root.style.setProperty('--accent', s.themeAccent);
    root.style.setProperty('--accent-rgb', hexRgb(s.themeAccent));
    root.style.setProperty('--warm', s.themeSecondary);
    root.style.setProperty('--warm-rgb', hexRgb(s.themeSecondary));
    root.style.setProperty('--glass-tint', s.glassTint);
    root.style.setProperty('--glass-tint-rgb', hexRgb(s.glassTint));
    root.style.setProperty('--app-background', 'color-mix(in srgb, var(--bg) 78%, ' + s.glassTint + ')');
    root.style.setProperty('--app-surface', 'color-mix(in srgb, var(--bg) 48%, ' + s.glassTint + ')');
    root.style.setProperty('--app-surface-raised', 'color-mix(in srgb, var(--bg) 30%, ' + s.glassTint + ')');
    root.style.setProperty('--glass-edge', s.glassEdge);
    root.style.setProperty('--glass-edge-rgb', hexRgb(s.glassEdge));
    root.style.setProperty('--glass-glow', s.glassGlow);
    root.style.setProperty('--glass-glow-rgb', hexRgb(s.glassGlow));
    root.style.setProperty('--glass-reflection', s.glassReflection);
    root.style.setProperty('--glass-reflection-rgb', hexRgb(s.glassReflection));
    root.style.setProperty('--glass-opacity', Math.max(8, Math.min(72, Number(s.glassOpacity) || 34)) / 100);
    root.style.setProperty('--glass-blur', Math.max(8, Math.min(48, Number(s.glassBlur) || 32)) + 'px');
    root.style.setProperty('--glass-saturation', Math.max(100, Math.min(260, Number(s.glassSaturation) || 185)) + '%');
    root.style.setProperty('--glass-edge-strength', Math.max(5, Math.min(85, Number(s.glassEdgeStrength) || 34)) / 100);
  }
  function applySettings() {
    const s = Store.getSettings();
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.dataset.accent = s.accent;
    applyThemeStudio(s);
    document.body.classList.toggle('glass', !!s.glass);
    const nowPlaying = $('npFull');
    if (nowPlaying) nowPlaying.classList.toggle('lyrics-glass', !!s.npGlass);
    updateAlbumBg();
  }
  function saveThemeStudioFromControls() {
    const patch = {
      themeAccent: $('themeAccent').value,
      themeSecondary: $('themeSecondary').value,
      glassTint: $('glassTint').value,
      glassEdge: $('glassEdge').value,
      glassGlow: $('glassGlow').value,
      glassReflection: $('glassReflection').value,
      glassOpacity: Number($('glassOpacity').value),
      glassBlur: Number($('glassBlur').value),
      glassSaturation: Number($('glassSaturation').value),
      glassEdgeStrength: Number($('glassEdgeStrength').value)
    };
    Store.saveSettings(patch);
    applyThemeStudio(patch);
    ['themeAccent','themeSecondary','glassTint','glassEdge','glassGlow','glassReflection'].forEach(id => {
      const hex = $(id).value.toUpperCase();
      const field = $(id + 'Hex');
      if (field && field !== document.activeElement) field.value = hex;
    });
    $('glassOpacityValue').textContent = patch.glassOpacity + '%';
    $('glassBlurValue').textContent = patch.glassBlur + 'px';
    $('glassSaturationValue').textContent = patch.glassSaturation + '%';
    $('glassEdgeStrengthValue').textContent = patch.glassEdgeStrength + '%';
  }
  function loadThemeStudioControls(settings) {
    const s = Object.assign({}, DEFAULT_THEME_STUDIO, settings || {});
    Object.keys(DEFAULT_THEME_STUDIO).forEach(key => { $(key).value = s[key]; });
    $('glassOpacityValue').textContent = s.glassOpacity + '%';
    $('glassBlurValue').textContent = s.glassBlur + 'px';
    $('glassSaturationValue').textContent = s.glassSaturation + '%';
    $('glassEdgeStrengthValue').textContent = s.glassEdgeStrength + '%';
    ['themeAccent','themeSecondary','glassTint','glassEdge','glassGlow','glassReflection'].forEach(id => {
      $(id + 'Hex').value = s[id].toUpperCase();
    });
  }

  function updateAlbumBg() {
    const s = Store.getSettings();
    const url = state.currentTrack && state.currentTrack.thumbnail;
    Background.setArt(s.albumBg ? url : '');
  }

  $('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    Store.saveSettings({ theme: next });
    applySettings();
  });


  $('fullscreenBtn').addEventListener('click', () => {
    if (window.desktop) window.desktop.toggleFullscreen();
  });

  // ---------- Views ----------
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
  document.querySelectorAll('.library-subnav-btn[data-library-view]').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.libraryView));
  });

  function showView(name) {
    const librarySection = ['library', 'playlists', 'queue', 'history'].includes(name);
    const mobileLayout = document.documentElement.dataset.deviceLayout === 'mobile';
    document.documentElement.dataset.libraryOpen = mobileLayout && librarySection ? 'true' : 'false';

    document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
      const activeName = mobileLayout && librarySection ? 'library' : name;
      b.classList.toggle('active', b.dataset.view === activeName);
    });
    document.querySelectorAll('.library-subnav-btn[data-library-view]').forEach(b => {
      b.classList.toggle('active', b.dataset.libraryView === name);
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'library') renderLibrary();
    if (name === 'playlists') renderPlaylists();
    if (name === 'history') renderHistory();
    if (name === 'queue') renderQueue();
    if (name === 'search') renderResults();
    if (name === 'rooms') window.ResonaRooms?.open();
  }

  // ---------- Shared API status ----------
  function updateQuotaBadge() {
    const badge = $('quotaBadge');
    if (badge) {
      badge.textContent = 'Shared search';
      badge.classList.remove('warn', 'out');
    }
    $('quotaWarning')?.classList.add('hidden');
  }

  function showBanner(text, kind) {
    const b = $('quotaWarning');
    b.textContent = text;
    b.className = 'banner' + (kind === 'error' ? ' error' : '');
  }

  // ---------- Search memory + discovery recommendation ----------
  const SEARCH_MEMORY_KEY = 'resona-search-memory-v1';
  function rememberSearchTracks(query, tracks) {
    if (!query || !tracks?.length) return;
    try {
      const old = JSON.parse(localStorage.getItem(SEARCH_MEMORY_KEY) || '[]');
      const entry = { query, at: Date.now(), tracks: tracks.slice(0, 12) };
      const next = [entry, ...old.filter(x => x.query.toLowerCase() !== query.toLowerCase())].slice(0, 12);
      localStorage.setItem(SEARCH_MEMORY_KEY, JSON.stringify(next));
    } catch (_) {}
  }
  function getDiscoveryPool() {
    try {
      return JSON.parse(localStorage.getItem(SEARCH_MEMORY_KEY) || '[]')
        .flatMap(x => x.tracks || [])
        .filter((track, i, all) => track?.id && all.findIndex(t => t.id === track.id) === i);
    } catch (_) { return []; }
  }
  function renderDiscovery() {
    const host = $('discoveryFeature');
    if (!host) return;
    const history = Store.getHistory();
    const current = state.currentTrack || history[0] || null;
    if (!current) {
      host.innerHTML = '<div class="discovery-placeholder"><span class="placeholder-orbit">♫</span><div><strong>Nothing playing just yet.</strong><p>Play a track and your listening session will appear here.</p></div></div>';
      return;
    }
    const queueTracks = state.queue.slice(Math.max(state.currentIndex + 1, 0), state.currentIndex + 4);
    const upNext = queueTracks.length ? queueTracks : history.filter(t => t.id !== current.id).slice(0, 3);
    host.replaceChildren();
    const art = document.createElement('img');
    art.className = 'discovery-art';
    art.src = current.thumbnail || '';
    art.alt = '';
    const copy = document.createElement('div');
    copy.className = 'discovery-copy';
    const tag = document.createElement('span');
    tag.className = 'discovery-tag';
    tag.textContent = 'PICK UP WHERE YOU LEFT OFF';
    const title = document.createElement('h2');
    title.textContent = current.title || 'Your recent track';
    const artist = document.createElement('p');
    artist.textContent = current.artist || 'Unknown artist';
    const actions = document.createElement('div');
    actions.className = 'discovery-actions';
    actions.append(
      button('▶ Continue playing', () => {
        const idx = state.queue.findIndex(t => t.id === current.id);
        if (idx >= 0) playQueueIndex(idx);
        else playFromList([current], current);
      }, 'btn primary'),
      button('↻ Remix', remixDiscoveries, 'btn ghost')
    );
    copy.append(tag, title, artist, actions);
    const next = document.createElement('aside');
    next.className = 'continue-next';
    const nextTitle = document.createElement('strong');
    nextTitle.textContent = 'Up next for you';
    next.append(nextTitle);
    if (!upNext.length) {
      const note = document.createElement('p');
      note.className = 'continue-empty';
      note.textContent = 'Your next tracks will show up here.';
      next.append(note);
    } else {
      upNext.forEach(track => {
        const row = document.createElement('button');
        row.className = 'continue-next-row';
        row.type = 'button';
        const thumb = document.createElement('img');
        thumb.src = track.thumbnail || '';
        thumb.alt = '';
        const details = document.createElement('span');
        const name = document.createElement('b');
        name.textContent = track.title || 'Untitled';
        const by = document.createElement('small');
        by.textContent = track.artist || 'Unknown artist';
        details.append(name, by);
        row.append(thumb, details);
        row.addEventListener('click', () => {
          const idx = state.queue.findIndex(t => t.id === track.id);
          if (idx >= 0) playQueueIndex(idx);
          else playFromList(upNext, track);
        });
        next.append(row);
      });
    }
    host.append(art, copy, next);
  }

  function remixDiscoveries() {
    const pool = getDiscoveryPool();
    if (pool.length < 2) {
      flashStatus('Search for a few tracks first, then Remix your discoveries.');
      return;
    }
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    state.queue = shuffled;
    saveQueue();
    renderQueue();
    playQueueIndex(0);
    flashStatus('Your discoveries have been remixed.');
  }
  $('remixBtn')?.addEventListener('click', remixDiscoveries);

  // ---------- Search (Enter only, cached, quota-aware) ----------
  const officialOnlyToggle = $('officialOnlyToggle');
  officialOnlyToggle.checked = localStorage.getItem('deepflow-official-only') !== 'false';
  officialOnlyToggle.addEventListener('change', () => {
    localStorage.setItem('deepflow-official-only', String(officialOnlyToggle.checked));
    renderResults();
    if (state.searchSource !== 'youtube') {
      $('searchStatus').textContent = 'Official-only filtering applies to YouTube. Other providers show their catalogue results as supplied.';
      return;
    }
    if (state.isSearch) {
      const count = state.results.length;
      $('searchStatus').textContent = officialOnlyToggle.checked
        ? (count ? `Showing ${count} likely official music result(s).` : 'No likely official upload found. Turn off Official only to see all results.')
        : `Showing all ${count} search result(s).`;
    }
  });

  $('searchSourceSelect').addEventListener('change', (event) => {
    const source = event.target.value;
    if (!['youtube', 'audius'].includes(source) || source === state.searchSource) return;
    state.searchSource = source;
    officialOnlyToggle.disabled = source !== 'youtube';
    officialOnlyToggle.closest('.official-filter')?.classList.toggle('source-filter-disabled', source !== 'youtube');
    const query = $('searchInput').value.trim();
    if (query.length >= 3) runSearch(query, true);
    else {
      state.rawResults = [];
      state.results = [];
      state.isSearch = false;
      $('results').replaceChildren();
      $('searchStatus').textContent = source === 'audius'
        ? 'Search Audius for independent artists and tracks.'
        : 'Search YouTube for music videos and official audio.';
    }
  });

  $('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (!q) {
      showHome();
      return;
    }
    $('searchStatus').textContent = 'Press Enter to search.';
  });

  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q.length < 3) {
        $('searchStatus').textContent = 'Type at least 3 characters, then press Enter.';
        return;
      }
      runSearch(q, true);
    }
  });

  // ---------- Home: popular music (1 quota unit, cached 24 hours) ----------
  async function showHome() {
    renderDiscovery();
    state.searchRequestId++;
    state.searchSource = 'youtube';
    $('searchSourceSelect').value = 'youtube';
    officialOnlyToggle.disabled = false;
    officialOnlyToggle.closest('.official-filter')?.classList.remove('source-filter-disabled');
    showView('search');
    const region = Store.getSettings().popularRegion || 'US';
    const cacheKey = 'popular:' + region;
    const cached = Store.getCachedSearch(cacheKey);
    if (cached) {
      state.rawResults = cached;
      state.isSearch = false;
      $('searchStatus').textContent = 'Popular music right now';
      renderResults();
      return;
    }

    $('searchStatus').textContent = 'Loading popular music…';
    try {
      const results = await YouTubeAPI.fetchPopular(region);
      Store.setCachedSearch(cacheKey, results);
      state.rawResults = results;
      state.isSearch = false;
      $('searchStatus').textContent = 'Popular music right now';
      renderResults();
    } catch (err) {
      $('searchStatus').textContent = 'Could not load popular music: ' + err.message;
    }
    updateQuotaBadge();
  }

  async function runSearch(query, force = false) {
    if (query === state.lastQuery && !force) return;
    state.lastQuery = query;
    const requestId = ++state.searchRequestId;
    showView('search');

    const source = state.searchSource;
    const cacheKey = source === 'youtube' ? query : source + ':' + query;
    const cached = Store.getCachedSearch(cacheKey);
    if (cached) {
      state.rawResults = cached;
      state.isSearch = true;
      renderResults();
      $('searchStatus').textContent = source === 'audius'
        ? (state.results.length ? `Showing ${state.results.length} Audius result(s) for "${query}".` : `No Audius results for "${query}".`)
        : (officialOnlyToggle.checked
          ? (state.results.length ? `Showing ${state.results.length} likely official cached result(s) for "${query}".` : 'No likely official upload found. Turn off Official only to see all results.')
          : `Showing all ${state.results.length} cached results for "${query}".`);
      return;
    }

    $('searchStatus').textContent = source === 'audius'
      ? `Searching Audius for "${query}"…`
      : `Searching YouTube for "${query}"…`;
    try {
      const results = source === 'audius'
        ? await AudiusAPI.search(query)
        : await YouTubeAPI.search(query);
      if (requestId !== state.searchRequestId || source !== state.searchSource) return;
      Store.setCachedSearch(cacheKey, results);
      state.rawResults = results;
      state.isSearch = true;
      renderResults();
      $('searchStatus').textContent = source === 'audius'
        ? (results.length ? `Showing ${results.length} Audius result(s) for "${query}". EQ is available when the stream permits browser processing.` : `No Audius results for "${query}".`)
        : (officialOnlyToggle.checked
          ? (state.results.length ? `Showing ${state.results.length} likely official result(s) for "${query}".` : 'No likely official upload found. Turn off Official only to see all results.')
          : (results.length ? `Showing all ${results.length} results for "${query}".` : `No results for "${query}".`));
    } catch (err) {
      if (requestId !== state.searchRequestId || source !== state.searchSource) return;
      $('searchStatus').textContent = (source === 'audius' ? 'Audius search failed: ' : 'YouTube search failed: ') + err.message;
    }
    updateQuotaBadge();
  }

  // ---------- Track rendering ----------
  function trackRow(track, opts = {}) {
    const row = document.createElement('div');
    row.className = 'track';
    if (state.currentTrack && state.currentTrack.id === track.id) row.classList.add('playing');

    const img = document.createElement('img');
    img.src = track.thumbnail || '';
    img.alt = '';
    img.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'track-info';
    const copy = document.createElement('div');
    copy.className = 'track-copy';
    const titleViewport = document.createElement('div');
    titleViewport.className = 'track-title-viewport';
    const t = document.createElement('span');
    t.className = 'track-title';
    t.textContent = track.title;
    t.title = track.title;
    titleViewport.append(t);
    const a = document.createElement('div');
    a.className = 'track-artist';
    a.textContent = track.artist + (track.source === 'audius' ? ' · Audius' : '');
    copy.append(titleViewport, a);
    const actions = document.createElement('div');
    actions.className = 'track-actions';

    if (opts.moveable) {
      const move = document.createElement('div');
      move.className = 'move-btns';
      move.append(
        button('▲', () => opts.moveable(-1), 'btn'),
        button('▼', () => opts.moveable(1), 'btn')
      );
      actions.append(move);
    }

    actions.append(
      button('▶', () => {
        if (track.source === 'local-audio') {
          $('audioToolsDialog').classList.remove('hidden');
          $('audioToolsDialog').setAttribute('aria-hidden', 'false');
          $('audioToolsStatus').textContent = 'Choose the original file again to play this local track.';
          $('audioFileInput').click();
        } else {
          playFromList(opts.list || [track], track);
        }
      }, 'btn small primary track-play-btn')
    );

    const moreWrap = document.createElement('div');
    moreWrap.className = 'track-more-wrap';
    const moreButton = button('⋯', () => {
      const willOpen = moreMenu.hidden;
      document.querySelectorAll('.track-more-menu').forEach(menu => { menu.hidden = true; });
      moreMenu.hidden = !willOpen;
      moreButton.setAttribute('aria-expanded', String(willOpen));
    }, 'btn small track-more-btn');
    moreButton.setAttribute('aria-label', 'More song actions');
    moreButton.setAttribute('aria-expanded', 'false');
    const moreMenu = document.createElement('div');
    moreMenu.className = 'track-more-menu';
    moreMenu.hidden = true;
    const addQueueButton = button('Add to queue', () => {
      addToQueue(track);
      moreMenu.hidden = true;
      moreButton.setAttribute('aria-expanded', 'false');
    }, 'track-more-item');
    const playlistButton = button('Add to playlist', () => {
      moreMenu.hidden = true;
      moreButton.setAttribute('aria-expanded', 'false');
      openPicker(track);
    }, 'track-more-item');
    moreMenu.append(addQueueButton, playlistButton);
    if (window.ResonaRooms?.isActive()) {
      moreMenu.append(button('Suggest to room', () => {
        moreMenu.hidden = true;
        moreButton.setAttribute('aria-expanded', 'false');
        window.ResonaRooms.suggestTrack(track);
      }, 'track-more-item'));
    }
    moreWrap.append(moreButton, moreMenu);
    actions.append(moreWrap);
    if (opts.removable) {
      actions.append(button('Remove', () => opts.removable(track), 'btn small danger'));
    }

    info.append(copy, actions);
    row.append(img, info);
    requestAnimationFrame(() => {
      if (t.scrollWidth > titleViewport.clientWidth + 3) {
        titleViewport.style.setProperty('--title-overflow', (t.scrollWidth - titleViewport.clientWidth) + 'px');
        titleViewport.classList.add('is-overflowing');
      }
    });
    return row;
  }

  function button(label, onClick, cls) {
    const b = document.createElement('button');
    b.className = cls || 'btn small';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function emptyNote(text) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = text;
    return d;
  }

  function officialMatchScore(track, query) {
    const title = String(track.title || '').toLowerCase();
    const channel = String(track.artist || '').toLowerCase();
    const excluded = /\b(lyrics?|lyric video|cover|karaoke|nightcore|slowed|reverb|sped up|speed up|8d audio|bass boosted|reaction|shorts?|fan edit|非公式)\b/i;
    if (excluded.test(title)) return -1;

    let score = 0;
    if (/\b(vevo|topic|official|records?|recordings|music|entertainment)\b/i.test(channel)) score += 4;
    if (/\b(vevo|official)\b/i.test(title)) score += 3;
    if (/\b(official audio|official video|music video)\b/i.test(title)) score += 2;
    if (channel && title.includes(channel.replace(/\s*[-–]?\s*topic$/, '').trim())) score += 2;

    const ignored = new Set(['official', 'audio', 'video', 'music', 'song', 'songs', 'the', 'and', 'for', 'from']);
    const queryWords = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !ignored.has(word));
    if (queryWords.some(word => channel.includes(word))) score += 2;
    return score;
  }

  function getOfficialResults() {
    return state.rawResults
      .map(track => ({ track, score: officialMatchScore(track, state.lastQuery) }))
      .filter(item => item.score >= 2)
      .sort((a, b) => b.score - a.score)
      .map(item => item.track);
  }

  function renderResults() {
    const box = $('results');
    box.replaceChildren();
    state.results = state.isSearch && state.searchSource === 'youtube' && officialOnlyToggle.checked
      ? getOfficialResults()
      : state.rawResults.slice();
    state.results.forEach(track => box.append(trackRow(track, { list: state.results })));
  }

  function renderLibrary() {
    const box = $('libraryList');
    box.replaceChildren();
    const lib = Store.getLibrary();
    if (!lib.length) return box.append(emptyNote('No saved tracks yet. Click ☆ Save on any track.'));
    lib.forEach(track => box.append(trackRow(track, {
      list: lib,
      removable: () => { Store.removeTrack(track.id); renderLibrary(); }
    })));
  }

  function renderHistory() {
    const box = $('historyList');
    box.replaceChildren();
    const list = Store.getHistory();
    if (!list.length) return box.append(emptyNote('Nothing played yet.'));
    list.forEach(track => box.append(trackRow(track, { list })));
  }

  $('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Clear your play history?')) {
      Store.clearHistory();
      renderHistory();
    }
  });

  function renderPlaylists() {
    const c = $('playlistsContainer');
    c.replaceChildren();
    const pls = Store.getPlaylists();
    if (!pls.length) return c.append(emptyNote('No playlists yet. Create one above.'));

    pls.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'playlist-card';

      const head = document.createElement('div');
      head.className = 'playlist-head';
      const h = document.createElement('h3');
      h.textContent = `${pl.name} (${pl.tracks.length})`;
      head.append(h);

      const acts = document.createElement('div');
      acts.className = 'row';
      acts.append(
        button('▶ Play all', () => pl.tracks.length && playFromList(pl.tracks, pl.tracks[0]), 'btn small primary'),
        button('Queue all', () => { pl.tracks.forEach(t => addToQueue(t, true)); renderQueue(); }, 'btn small'),
        button('Rename', () => {
          const name = prompt('New name for playlist:', pl.name);
          if (name && name.trim()) { Store.renamePlaylist(pl.id, name); renderPlaylists(); }
        }, 'btn small ghost'),
        button('Delete', () => {
          if (confirm(`Delete playlist "${pl.name}"? Saved tracks in your library are not affected.`)) {
            Store.deletePlaylist(pl.id); renderPlaylists();
          }
        }, 'btn small danger')
      );
      head.append(acts);
      card.append(head);

      const list = document.createElement('div');
      list.className = 'track-list';
      if (!pl.tracks.length) list.append(emptyNote('Empty. Use "Add to playlist" on any track.'));
      pl.tracks.forEach(track => list.append(trackRow(track, {
        list: pl.tracks,
        removable: () => { Store.removeFromPlaylist(pl.id, track.id); renderPlaylists(); }
      })));
      card.append(list);
      c.append(card);
    });
  }

  $('createPlaylistBtn').addEventListener('click', () => {
    const input = $('newPlaylistName');
    if (!input.value.trim()) return;
    Store.createPlaylist(input.value);
    input.value = '';
    renderPlaylists();
  });

  // ---------- Playlist picker ----------
  function openPicker(track) {
    state.pickerTrack = track;
    const list = $('pickerList');
    list.replaceChildren();
    const pls = Store.getPlaylists();
    if (!pls.length) list.append(emptyNote('Create a playlist first in the Playlists tab.'));
    pls.forEach(pl => {
      list.append(button(`${pl.name} (${pl.tracks.length})`, () => {
        Store.addToPlaylist(pl.id, track);
        $('pickerDialog').classList.add('hidden');
        refreshCurrent();
      }, 'btn ghost'));
    });
    $('pickerDialog').classList.remove('hidden');
  }
  $('pickerClose').addEventListener('click', () => $('pickerDialog').classList.add('hidden'));

  // ---------- Queue ----------
  function saveQueue() {
    Store.setQueue(state.queue);
    $('queueCount').textContent = state.queue.length;
  }

  function addToQueue(track, silent) {
    if (!track || !track.id) return;
    state.queue.push(track);
    saveQueue();
    if (!silent) flashStatus(`Added "${track.title}" to the queue.`);
    if (state.currentIndex === -1 && !state.currentTrack) playQueueIndex(0);
  }

  function playFromList(list, track) {
    const start = list.findIndex(t => t.id === track.id);
    state.queue = list.slice(Math.max(start, 0)).map(t => ({ ...t }));
    saveQueue();
    playQueueIndex(0);
  }

  // Move a queue item from index i to index j, keeping the current track pointer correct
  function moveQueue(i, j) {
    if (j < 0 || j >= state.queue.length) return;
    const [item] = state.queue.splice(i, 1);
    state.queue.splice(j, 0, item);
    const c = state.currentIndex;
    if (c === i) state.currentIndex = j;
    else if (i < c && c <= j) state.currentIndex = c - 1;
    else if (j <= c && c < i) state.currentIndex = c + 1;
    saveQueue();
    renderQueue();
  }

  function renderQueue() {
    const box = $('queueList');
    box.replaceChildren();
    $('queueCount').textContent = state.queue.length;
    if (!state.queue.length) return box.append(emptyNote('Queue is empty.'));
    state.queue.forEach((track, i) => {
      const row = trackRow(track, {
        list: state.queue,
        moveable: (dir) => moveQueue(i, i + dir),
        removable: () => {
          state.queue.splice(i, 1);
          if (i < state.currentIndex) state.currentIndex--;
          else if (i === state.currentIndex) state.currentIndex = -1;
          saveQueue();
          renderQueue();
        }
      });
      row.addEventListener('dblclick', () => playQueueIndex(i));
      box.append(row);
    });
  }

  window.addEventListener('deepflow:queue-track', (e) => addToQueue(e.detail, true));
  window.addEventListener('deepflow:sleep-stop', () => {
    if (state.audioMode) ResonaAudio.pause();
    else if (state.playerReady && state.player) state.player.pauseVideo();
    setPlayingUI(false);
    flashStatus('Sleep timer finished. Playback paused.');
    window.dispatchEvent(new Event('deepflow:sleep-ended'));
  });

  $('clearQueueBtn').addEventListener('click', () => {
    state.queue = [];
    state.currentIndex = -1;
    saveQueue();
    renderQueue();
  });

  // ---------- Playback (official YouTube IFrame Player API) ----------
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.append(tag);
  }

  window.onYouTubeIframeAPIReady = function () {
    state.player = new YT.Player('ytHolder', {
      width: '200',
      height: '113',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          state.playerReady = true;
          applyVolume();
          if (state.pendingVideoId) {
            state.player.loadVideoById(state.pendingVideoId);
            state.pendingVideoId = null;
          }
        },
        onStateChange: onPlayerStateChange,
        onError: (e) => {
          const msg = {
            2: 'Invalid video.',
            5: 'Player error in this video.',
            100: 'This video was removed or is private.',
            101: 'The owner does not allow embedded playback. Skipping.',
            150: 'The owner does not allow embedded playback. Skipping.',
            153: 'Player configuration error. Skipping.'
          }[e.data] || 'Playback error. Skipping.';
          flashStatus(msg);
          setTimeout(playNext, 1200);
        }
      }
    });
  };

  function onPlayerStateChange(e) {
    if (state.audioMode) return;
    // YT.PlayerState: ENDED = 0, PLAYING = 1, PAUSED = 2
    if (e.data === 0) handleTrackEnded();
    if (e.data === 1) setPlayingUI(true);
    if (e.data === 2) setPlayingUI(false);
  }

  async function playQueueIndex(i) {
    if (i < 0 || i >= state.queue.length) return;
    state.currentIndex = i;
    const track = state.queue[i];
    state.currentTrack = track;
    state.audioMode = track.source === 'audius' || track.source === 'local-audio';
    if (state.audioMode && state.playerReady) state.player.pauseVideo();
    Store.addToHistory(track);
    renderDiscovery();
    showNowPlaying(track);

    if (track.source === 'audius') {
      state.pendingVideoId = null;
      try {
        const streamUrl = AudiusAPI.getStreamUrl(track.audiusId);
        ResonaAudio.loadUrl(streamUrl);
        ResonaAudio.setVolume(Number($('volumeSlider').value));
        $('audioSourceTitle').textContent = track.title;
        const sourceName = 'Audius';
        $('audioSourceMeta').textContent = sourceName + ' audio · Resona EQ enabled';
        $('audioToolsStatus').textContent = 'Equalizer active for ' + sourceName + ' playback.';
        await ResonaAudio.play();
      } catch (err) {
        setPlayingUI(false);
        $('audioToolsStatus').textContent = track.source + ' playback failed: ' + err.message;
        flashStatus(track.source + ' playback failed: ' + err.message);
      }
    } else if (track.source === 'local-audio') {
      setPlayingUI(false);
      $('audioToolsStatus').textContent = 'Re-import this local file to play it again.';
      flashStatus('This local file needs to be imported again.');
    } else {
      state.audioMode = false;
      ResonaAudio.stop();
      if (state.playerReady) state.player.loadVideoById(track.id);
      else state.pendingVideoId = track.id;
    }
    renderQueue();
    refreshCurrent();
  }

  async function handleTrackEnded() {
    const endedIndex = state.currentIndex;
    if (endedIndex + 1 >= state.queue.length) {
      setPlayingUI(false);
      return;
    }

    await SupportMessage.afterTrackEnds();
    // If the user pressed Next while the announcement was playing, don't skip again.
    if (state.currentIndex === endedIndex) playNext();
  }

  function playNext() {
    SupportMessage.cancel();
    if (state.currentIndex + 1 < state.queue.length) playQueueIndex(state.currentIndex + 1);
    else if (state.audioMode) { ResonaAudio.pause(); setPlayingUI(false); }
    else setPlayingUI(false);
  }

  function playPrev() {
    if (state.audioMode) { ResonaAudio.seek(0); return; }
    if (state.currentIndex > 0) playQueueIndex(state.currentIndex - 1);
  }

  function togglePlay() {
    if (!state.currentTrack) return;
    if (state.audioMode) {
      ResonaAudio.toggle().catch(err => flashStatus('Audio playback failed: ' + err.message));
      return;
    }
    if (!state.playerReady) return;
    const st = state.player.getPlayerState();
    if (st === 1) state.player.pauseVideo();
    else state.player.playVideo();
  }

  // Small bridge used by Listening Rooms to keep each member's player aligned.
  window.ResonaPlayback = {
    play(track, position = 0, playing = true) {
      if (!track || track.source === 'local-audio') return;
      // Room playback must not overwrite a listener's personal queue.
      const personalQueue = state.queue;
      const personalIndex = state.currentIndex;
      playFromList([track], track);
      state.queue = personalQueue;
      state.currentIndex = personalIndex;
      saveQueue();
      renderQueue();
      window.setTimeout(() => this.setState(playing, position), 1200);
    },
    setState(playing, position = null) {
      if (!state.currentTrack) return;
      if (position !== null && Number.isFinite(Number(position))) {
        const target = Math.max(0, Number(position));
        if (state.audioMode) ResonaAudio.seek(target);
        else if (state.playerReady) state.player.seekTo(target, true);
      }
      if (state.audioMode) {
        if (playing) ResonaAudio.play().catch(err => flashStatus('Room audio could not start: ' + err.message));
        else ResonaAudio.pause();
      } else if (state.playerReady) {
        if (playing) state.player.playVideo();
        else state.player.pauseVideo();
      }
    },
    getPosition() {
      try {
        if (state.audioMode) return ResonaAudio.getTime();
        if (state.playerReady) return state.player.getCurrentTime();
      } catch (_) {}
      return 0;
    }
  };

  function setPlayingUI(playing) {
    NowPlaying.setPlaying(playing);
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    $('visualizer').classList.toggle('active', playing);
    $('visualizer').classList.toggle('audio-reactive', !!playing && !!state.audioMode);
  }

  function showNowPlaying(track) {
    $('npTitle').textContent = track.title;
    $('npArtist').textContent = track.artist;
    $('npThumb').src = track.thumbnail || '';
    NowPlaying.setTrack(track);
    setPlayingUI(true);
    updateAlbumBg();
  }

  function applyVolume() {
    const volume = Number($('volumeSlider').value);
    ResonaAudio.setVolume(volume);
    if (state.playerReady) state.player.setVolume(volume);
  }

  $('playBtn').addEventListener('click', togglePlay);
  $('nextBtn').addEventListener('click', playNext);
  $('prevBtn').addEventListener('click', playPrev);
  $('volumeSlider').addEventListener('input', applyVolume);
  $('eqBtn').addEventListener('click', () => {
    syncEqualizerControls();
    $('audioToolsDialog').classList.remove('hidden');
    $('audioToolsDialog').setAttribute('aria-hidden', 'false');
  });
  $('closeAudioTools').addEventListener('click', () => {
    $('audioToolsDialog').classList.add('hidden');
    $('audioToolsDialog').setAttribute('aria-hidden', 'true');
  });
  $('importAudioBtn').addEventListener('click', () => $('audioFileInput').click());
  $('startTabCaptureBtn').addEventListener('click', async () => {
    const startButton = $('startTabCaptureBtn');
    startButton.disabled = true;
    $('audioToolsStatus').textContent = 'Choose the Resona tab in your browser picker and enable Share tab audio.';
    try {
      ResonaAudio.pause();
      await ResonaAudio.startTabCapture();
      $('startTabCaptureBtn').textContent = 'Tab capture active';
      $('stopTabCaptureBtn').disabled = false;
      $('audioSourceTitle').textContent = 'Browser tab audio';
      $('audioSourceMeta').textContent = 'Resona tab · Real-time EQ enabled';
      $('audioToolsStatus').textContent = 'Tab audio is now routed through Resona EQ. Adjust Bass, Mids, Treble or Advanced bands while the tab plays.';
      syncEqualizerControls();
    } catch (err) {
      $('audioToolsStatus').textContent = err.message || 'Could not capture tab audio.';
      startButton.disabled = false;
    }
  });
  $('stopTabCaptureBtn').addEventListener('click', () => ResonaAudio.stopTabCapture());
  window.addEventListener('resona:tab-capture-start', () => {
    $('startTabCaptureBtn').disabled = true;
    $('stopTabCaptureBtn').disabled = false;
  });
  window.addEventListener('resona:tab-capture-stop', () => {
    $('startTabCaptureBtn').disabled = false;
    $('startTabCaptureBtn').textContent = 'Capture tab audio for EQ';
    $('stopTabCaptureBtn').disabled = true;
    $('audioToolsStatus').textContent = 'Tab capture stopped. Your browser tab audio is no longer routed through Resona EQ.';
  });
  $('audioFileInput').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      if (state.playerReady) state.player.pauseVideo();
      const info = ResonaAudio.loadFile(file);
      const track = {
        id: 'local-audio-' + Date.now(),
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: 'Local audio file',
        thumbnail: '',
        source: 'local-audio',
        fileName: file.name
      };
      state.audioMode = true;
      state.currentIndex = -1;
      state.currentTrack = track;
      Store.addToHistory(track);
      renderDiscovery();
      showNowPlaying(track);
      ResonaAudio.setVolume(Number($('volumeSlider').value));
      $('audioSourceTitle').textContent = info.name;
      $('audioSourceMeta').textContent = 'Local file · ' + (info.type || 'audio file');
      $('audioToolsStatus').textContent = 'Equalizer active for this local track.';
      await ResonaAudio.play();
      setPlayingUI(true);
      flashStatus('Playing imported audio with Resona EQ.');
      syncEqualizerControls();
    } catch (err) {
      $('audioToolsStatus').textContent = err.message || 'Could not open this audio file.';
      flashStatus('Audio playback failed: ' + (err.message || 'unsupported file'));
    }
    event.target.value = '';
  });
  function syncEqualizerControls() {
    const values = ResonaAudio.getBands();
    document.querySelectorAll('[data-eq-band]').forEach(input => {
      const index = Number(input.dataset.eqBand);
      input.value = values[index] ?? 0;
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\\.0$/, '') + ' dB';
    });
    const simple = ResonaAudio.getSimpleBands();
    document.querySelectorAll('[data-eq-simple]').forEach(input => {
      input.value = simple[input.dataset.eqSimple] ?? 0;
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\\.0$/, '') + ' dB';
    });
  }
  document.querySelectorAll('[data-eq-band]').forEach(input => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.eqBand);
      ResonaAudio.setBand(index, Number(input.value));
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\\.0$/, '') + ' dB';
      $('eqPreset').value = 'custom';
      syncEqualizerControls();
    });
  });
  document.querySelectorAll('[data-eq-simple]').forEach(input => {
    input.addEventListener('input', () => {
      ResonaAudio.setSimpleBand(input.dataset.eqSimple, Number(input.value));
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\\.0$/, '') + ' dB';
      $('eqPreset').value = 'custom';
      syncEqualizerControls();
    });
  });
  $('eqAdvancedToggle').addEventListener('click', () => {
    const panel = $('eqAdvancedPanel');
    const open = panel.classList.toggle('hidden') === false;
    $('eqAdvancedToggle').textContent = open ? 'Simple' : 'Advanced';
    $('eqAdvancedToggle').setAttribute('aria-expanded', String(open));
  });
  $('eqHelpToggle').addEventListener('click', () => {
    const panel = $('eqHelpPopover');
    const open = panel.classList.toggle('hidden') === false;
    $('eqHelpToggle').setAttribute('aria-expanded', String(open));
  });
  $('eqPreset').addEventListener('change', () => {
    if ($('eqPreset').value === 'custom') return;
    const values = ResonaAudio.applyPreset($('eqPreset').value);
    document.querySelectorAll('[data-eq-band]').forEach(input => {
      input.value = values[Number(input.dataset.eqBand)];
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\\.0$/, '') + ' dB';
    });
    syncEqualizerControls();
  });
  $('eqReset').addEventListener('click', () => {
    $('eqPreset').value = 'flat';
    ResonaAudio.applyPreset('flat');
    syncEqualizerControls();
  });
  $('audioToolsDialog').addEventListener('click', event => {
    if (event.target === $('audioToolsDialog')) {
      $('audioToolsDialog').classList.add('hidden');
      $('audioToolsDialog').setAttribute('aria-hidden', 'true');
    }
  });
  let visualizerFrame = 0;
  function animateAudioVisualizer() {
    if (!state.audioMode || !ResonaAudio.isPlaying()) {
      $('visualizer').querySelectorAll('span').forEach(bar => { bar.style.height = ''; });
      return;
    }
    const values = ResonaAudio.getFrequencyData();
    const bassEnergy = ResonaAudio.getBassEnergy();
    const bars = $('visualizer').querySelectorAll('span');
    if (bassEnergy > 0.58 && animateAudioVisualizer.lastBass < 0.48) {
      const visualizer = $('visualizer');
      visualizer.classList.add('beat-hit');
      setTimeout(() => visualizer.classList.remove('beat-hit'), 115);
    }
    animateAudioVisualizer.lastBass = bassEnergy;
    bars.forEach((bar, index) => {
      const bin = Math.min(values.length - 1, Math.floor(1 + Math.pow(index / Math.max(1, bars.length - 1), 1.65) * (values.length * 0.72)));
      bar.style.height = (3 + ((values[bin] || 0) / 255) * 17) + 'px';
    });
    visualizerFrame = requestAnimationFrame(animateAudioVisualizer);
  }
  window.addEventListener('resona:audio-play', () => {
    if (!state.audioMode) return;
    setPlayingUI(true);
    cancelAnimationFrame(visualizerFrame);
    visualizerFrame = requestAnimationFrame(animateAudioVisualizer);
  });
  window.addEventListener('resona:audio-pause', () => {
    if (!state.audioMode) return;
    setPlayingUI(false);
    cancelAnimationFrame(visualizerFrame);
    $('visualizer').querySelectorAll('span').forEach(bar => { bar.style.height = ''; });
  });
  ResonaAudio.onTrackEnded(() => {
    if (!state.audioMode) return;
    $('audioToolsStatus').textContent = 'Track finished.';
    if (state.currentIndex + 1 < state.queue.length) playNext();
    else setPlayingUI(false);
  });
  window.addEventListener('resona:audio-error', event => {
    $('audioToolsStatus').textContent = event.detail.message;
    setPlayingUI(false);
  });


  // ---------- Status helper ----------
  let statusTimer = null;
  function flashStatus(text) {
    $('searchStatus').textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (state.lastQuery) $('searchStatus').textContent = '';
    }, 3000);
  }

  function refreshCurrent() {
    const active = document.querySelector('.view.active');
    if (!active) return;
    if (active.id === 'view-search') renderResults();
    if (active.id === 'view-library') renderLibrary();
    if (active.id === 'view-playlists') renderPlaylists();
    if (active.id === 'view-history') renderHistory();
    if (active.id === 'view-queue') renderQueue();
  }

  // ---------- Background (user-provided MP4 only) ----------
  $('bgFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!Background.chooseFile(file)) {
        e.target.value = '';
        $('freshBgToggle').checked = false;
        $('bgEnabled').checked = false;
        Background.setEnabled(false);
      } else {
        $('freshBgToggle').checked = true;
        $('bgEnabled').checked = true;
      }
    } else if (!Background.hasSource()) {
      $('freshBgToggle').checked = false;
      $('bgEnabled').checked = false;
      Background.setEnabled(false);
    }
  });

  $('bgEnabled').addEventListener('change', (e) => {
    Background.setEnabled(e.target.checked);
    $('freshBgToggle').checked = e.target.checked;
  });
  $('freshBgToggle').addEventListener('change', (e) => {
    const enabled = e.target.checked;
    $('bgEnabled').checked = enabled;
    if (enabled && !Background.hasSource()) {
      $('bgFileInput').click();
      return;
    }
    Background.setEnabled(enabled);
  });

  // ---------- Settings dialog ----------
  $('customizeBtn').addEventListener('click', () => {
    $('settingsBtn').click();
    $('themeStudioTitle')?.scrollIntoView({ behavior:'smooth', block:'start' });
  });

  $('settingsBtn').addEventListener('click', () => {
    const s = Store.getSettings();
    $('sizeSelect').value = s.windowSize;
    $('regionSelect').value = s.popularRegion || 'US';
    $('albumBgToggle').checked = !!s.albumBg;
    $('glassToggle').checked = !!s.glass;
    $('npGlassToggle').checked = !!s.npGlass;
    loadThemeStudioControls(s);
    $('bgEnabled').checked = !!s.bgEnabled;
    $('freshBgToggle').checked = !!s.bgEnabled;
    $('settingsDialog').classList.remove('hidden');
  });

  $('albumBgToggle').addEventListener('change', (e) => {
    Store.saveSettings({ albumBg: e.target.checked });
    updateAlbumBg();
  });

  $('glassToggle').addEventListener('change', (e) => {
    Store.saveSettings({ glass: e.target.checked });
    applySettings();
  });

  $('npGlassToggle').addEventListener('change', (e) => {
    Store.saveSettings({ npGlass: e.target.checked });
    applySettings();
  });

  ['themeAccent','themeSecondary','glassTint','glassEdge','glassGlow','glassReflection','glassOpacity','glassBlur','glassSaturation','glassEdgeStrength'].forEach(id => {
    $(id).addEventListener('input', saveThemeStudioFromControls);
    $(id).addEventListener('change', saveThemeStudioFromControls);
  });
  ['themeAccent','themeSecondary','glassTint','glassEdge','glassGlow','glassReflection'].forEach(id => {
    const field = $(id + 'Hex');
    const applyHex = () => {
      const value = field.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        $(id).value = value;
        saveThemeStudioFromControls();
        field.setCustomValidity('');
      } else {
        field.setCustomValidity('Enter a 6-digit HEX colour, for example #67CFE0.');
      }
    };
    field.addEventListener('input', applyHex);
    field.addEventListener('change', () => {
      applyHex();
      if (!/^#[0-9a-f]{6}$/i.test(field.value.trim())) field.reportValidity();
    });
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); applyHex(); field.blur(); }
    });
  });
  document.querySelectorAll('[data-theme-preset]').forEach(button => {
    button.addEventListener('click', () => {
      loadThemeStudioControls(THEME_PRESETS[button.dataset.themePreset]);
      saveThemeStudioFromControls();
      document.querySelectorAll('[data-theme-preset]').forEach(item => item.classList.toggle('active', item === button));
    });
  });
  $('resetThemeStudio').addEventListener('click', () => {
    loadThemeStudioControls(DEFAULT_THEME_STUDIO);
    saveThemeStudioFromControls();
    document.querySelectorAll('[data-theme-preset]').forEach(item => item.classList.remove('active'));
  });

  $('closeSettingsBtn').addEventListener('click', () => {
    const size = $('sizeSelect').value;
    Store.saveSettings({
      windowSize: size,
      popularRegion: $('regionSelect').value
    });
    if (window.desktop) {
      const [w, h] = size.split('x').map(Number);
      window.desktop.setSize(w, h);
    }
    $('settingsDialog').classList.add('hidden');
    updateQuotaBadge();
    if (!state.lastQuery) showHome();
  });

  $('clearCacheBtn').addEventListener('click', () => {
    Store.clearCache();
    flashStatus('Search cache cleared.');
  });

  NowPlaying.init({
    getTime: () => (state.audioMode ? ResonaAudio.getTime() : (state.playerReady ? state.player.getCurrentTime() : 0)),
    getDuration: () => (state.audioMode ? ResonaAudio.getDuration() : (state.playerReady ? state.player.getDuration() : 0)),
    seek: (t) => { if (state.audioMode) ResonaAudio.seek(t); else if (state.playerReady) state.player.seekTo(t, true); },
    toggle: togglePlay,
    next: playNext,
    prev: playPrev
  });

  // Full-page cursor lighting: viewport coordinates cover every scroll position and section.
  let spotlightFrame = 0;
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (spotlightFrame) cancelAnimationFrame(spotlightFrame);
    spotlightFrame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--pointer-x', event.clientX + 'px');
      document.documentElement.style.setProperty('--pointer-y', event.clientY + 'px');
      document.body.classList.add('pointer-active');
      spotlightFrame = 0;
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => {
    document.body.classList.remove('pointer-active');
  });

  // ---------- Start ----------
  applySettings();
  saveQueue();
  updateQuotaBadge();
  loadYouTubeApi();
  renderQueue();
  Background.init();
  $('freshBgToggle').checked = !!Store.getSettings().bgEnabled;

  const startSettings = Store.getSettings();
  if (window.desktop && startSettings.windowSize) {
    const [w, h] = startSettings.windowSize.split('x').map(Number);
    window.desktop.setSize(w, h);
  }

  showHome();
})();
