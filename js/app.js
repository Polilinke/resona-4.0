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
  $('brandHomeBtn')?.addEventListener('click', () => {
    showView('search');
    document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function showView(name) {
    if (!document.getElementById('view-' + name)) name = 'search';
    const librarySection = ['playlists', 'queue', 'history'].includes(name);
    const mobileLayout = document.documentElement.dataset.deviceLayout === 'mobile';
    document.documentElement.dataset.libraryOpen = mobileLayout && librarySection ? 'true' : 'false';

    document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
      const activeName = mobileLayout && librarySection ? 'playlists' : name;
      b.classList.toggle('active', b.dataset.view === activeName);
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
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
    Store.addRecentSearch(query, state.searchSource);
    window.dispatchEvent(new Event('resona:search-history-changed'));
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

    // Use metadata only when the provider actually supplies it.
    const meta = document.createElement('div');
    meta.className = 'track-meta';
    const metaDetails = document.createElement('div');
    metaDetails.className = 'track-meta-details';
    const albumName = track.album || track.albumTitle || track.releaseTitle || '';
    const releaseYear = track.releaseYear || track.year || '';
    if (albumName || releaseYear) {
      const album = document.createElement('span');
      album.className = 'track-album';
      album.textContent = [albumName, releaseYear].filter(Boolean).join(' · ');
      album.title = album.textContent;
      metaDetails.append(album);
    }
    const rawDuration = track.duration ?? track.durationSeconds ?? track.duration_seconds;
    let durationText = '';
    if (typeof rawDuration === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(rawDuration.trim())) {
      durationText = rawDuration.trim();
    } else if (Number.isFinite(Number(rawDuration)) && rawDuration !== null && rawDuration !== '') {
      const seconds = Math.max(0, Math.floor(Number(rawDuration)));
      durationText = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }
    if (durationText) {
      const duration = document.createElement('span');
      duration.className = 'track-duration';
      duration.textContent = durationText;
      metaDetails.append(duration);
    }
    const sonic = document.createElement('div');
    sonic.className = 'track-sonic';
    sonic.setAttribute('aria-hidden', 'true');
    sonic.innerHTML = '<span></span><span></span><span></span><i></i>';

    const waveform = document.createElement('div');
    waveform.className = 'track-waveform';
    waveform.setAttribute('aria-hidden', 'true');
    // A stable per-track seed gives every song its own waveform without audio analysis or API calls.
    const waveformSeed = String(track.id || track.title || track.artist || 'resona')
      .split('').reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
    let waveState = waveformSeed || 1;
    for (let barIndex = 0; barIndex < 24; barIndex++) {
      waveState = (waveState * 1664525 + 1013904223) >>> 0;
      const height = 5 + (waveState % 15);
      const bar = document.createElement('i');
      bar.style.setProperty('--wave-height', height + 'px');
      bar.style.setProperty('--wave-speed', (760 + (waveState % 720)) + 'ms');
      bar.style.animationDelay = '-' + (waveState % 1100) + 'ms';
      waveform.append(bar);
    }
    meta.append(metaDetails, sonic, waveform);

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
    const moreButton = button('⋯', () => {}, 'btn small track-more-btn');
    moreButton.setAttribute('aria-label', 'More song actions');
    moreButton.setAttribute('aria-expanded', 'false');
    const moreMenu = document.createElement('div');
    moreMenu.className = 'track-more-menu';
    moreMenu.setAttribute('role', 'menu');

    const closeMenu = () => {
      moreMenu.remove();
      moreButton.setAttribute('aria-expanded', 'false');
      if (window.__resonaActiveTrackMenu === moreMenu) {
        window.__resonaActiveTrackMenu = null;
        window.__resonaActiveTrackMenuButton = null;
      }
    };
    const addQueueButton = button('Add to queue', () => {
      addToQueue(track);
      closeMenu();
    }, 'track-more-item');
    addQueueButton.setAttribute('role', 'menuitem');
    const playlistButton = button('Add to playlist', () => {
      closeMenu();
      openPicker(track);
    }, 'track-more-item');
    playlistButton.setAttribute('role', 'menuitem');
    moreMenu.append(addQueueButton, playlistButton);
    if (window.ResonaRooms?.isActive()) {
      const suggestButton = button('Suggest to room', () => {
        closeMenu();
        window.ResonaRooms.suggestTrack(track);
      }, 'track-more-item');
      suggestButton.setAttribute('role', 'menuitem');
      moreMenu.append(suggestButton);
    }

    moreButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (window.__resonaActiveTrackMenu === moreMenu) {
        closeMenu();
        return;
      }
      document.querySelectorAll('.track-more-menu').forEach(menu => menu.remove());
      document.querySelectorAll('.track-more-btn[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));

      // Render the menu at document level so song rows and scroll containers cannot clip it.
      document.body.appendChild(moreMenu);
      window.__resonaActiveTrackMenu = moreMenu;
      window.__resonaActiveTrackMenuButton = moreButton;
      moreButton.setAttribute('aria-expanded', 'true');
      const rect = moreButton.getBoundingClientRect();
      const gap = 7;
      const menuHeight = moreMenu.offsetHeight || 96;
      const availableLeft = Math.max(1, rect.left - gap - 8);
      const menuWidth = Math.min(180, availableLeft);
      const left = rect.left - gap - menuWidth;
      const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.top - 2));
      moreMenu.style.width = menuWidth + 'px';
      moreMenu.style.minWidth = menuWidth + 'px';
      moreMenu.style.left = left + 'px';
      moreMenu.style.top = top + 'px';
      moreMenu.style.visibility = 'visible';
    });
    moreMenu.addEventListener('click', event => event.stopPropagation());
    if (!window.__resonaTrackMenuDismissBound) {
      window.__resonaTrackMenuDismissBound = true;
      document.addEventListener('pointerdown', event => {
        const menu = window.__resonaActiveTrackMenu;
        const trigger = window.__resonaActiveTrackMenuButton;
        if (menu && !menu.contains(event.target) && !trigger?.contains(event.target)) {
          menu.remove();
          trigger?.setAttribute('aria-expanded', 'false');
          window.__resonaActiveTrackMenu = null;
          window.__resonaActiveTrackMenuButton = null;
        }
      });
      const dismissTrackMenu = () => {
        const menu = window.__resonaActiveTrackMenu;
        const trigger = window.__resonaActiveTrackMenuButton;
        if (!menu) return;
        menu.remove();
        trigger?.setAttribute('aria-expanded', 'false');
        window.__resonaActiveTrackMenu = null;
        window.__resonaActiveTrackMenuButton = null;
      };
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') dismissTrackMenu();
      });
      window.addEventListener('resize', dismissTrackMenu);
      window.addEventListener('scroll', dismissTrackMenu, true);
    }
    moreWrap.append(moreButton);
    actions.append(moreWrap);
    if (opts.removable) {
      actions.append(button('Remove', () => opts.removable(track), 'btn small danger'));
    }

    info.append(copy, meta, actions);
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
    if (!window.__resonaPlaylistMenusBound) {
      window.__resonaPlaylistMenusBound = true;
      document.addEventListener('pointerdown', event => {
        if (event.target.closest('.playlist-menu-wrap')) return;
        document.querySelectorAll('.playlist-actions-menu').forEach(menu => { menu.hidden = true; });
        document.querySelectorAll('.playlist-menu-button[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.playlist-actions-menu').forEach(menu => { menu.hidden = true; });
        document.querySelectorAll('.playlist-menu-button[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
      });
    }
    if (!pls.length) return c.append(emptyNote('No playlists yet. Create your first playlist above.'));

    pls.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'playlist-card';

      const head = document.createElement('div');
      head.className = 'playlist-head';
      const cover = document.createElement('img');
      cover.className = 'playlist-cover';
      cover.alt = '';
      const coverUrl = pl.cover || pl.tracks?.[0]?.thumbnail || '';
      if (coverUrl) cover.src = coverUrl;
      else cover.classList.add('is-empty');
      const heading = document.createElement('div');
      heading.className = 'playlist-heading';
      const h = document.createElement('h3');
      h.textContent = pl.name;
      const count = document.createElement('span');
      count.className = 'playlist-track-count';
      count.textContent = `${pl.tracks.length} ${pl.tracks.length === 1 ? 'song' : 'songs'}`;
      heading.append(h, count);

      const acts = document.createElement('div');
      acts.className = 'playlist-card-actions';
      acts.append(
        button('▶ Play all', () => pl.tracks.length && playFromList(pl.tracks, pl.tracks[0]), 'btn small primary'),
        button('Queue all', () => { pl.tracks.forEach(t => addToQueue(t, true)); renderQueue(); }, 'btn small')
      );

      const menuWrap = document.createElement('div');
      menuWrap.className = 'playlist-menu-wrap';
      const menuButton = button('⋯', () => {
        const opening = menu.hidden;
        document.querySelectorAll('.playlist-actions-menu').forEach(m => { m.hidden = true; });
        menu.hidden = !opening;
        menuButton.setAttribute('aria-expanded', String(opening));
      }, 'btn small playlist-menu-button');
      menuButton.setAttribute('aria-label', 'Playlist options');
      menuButton.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');
      menu.className = 'playlist-actions-menu';
      menu.hidden = true;
      menu.append(
        button('Rename playlist', () => {
          const name = prompt('New name for playlist:', pl.name);
          if (name && name.trim()) { Store.renamePlaylist(pl.id, name); renderPlaylists(); }
        }, 'playlist-menu-item'),
        button('Change cover', () => coverInput.click(), 'playlist-menu-item'),
        button('Delete playlist', () => {
          if (confirm(`Delete playlist "${pl.name}"? Saved tracks in your library are not affected.`)) {
            Store.deletePlaylist(pl.id);
            renderPlaylists();
          }
        }, 'playlist-menu-item danger')
      );
      menu.addEventListener('click', event => event.stopPropagation());
      menuWrap.append(menuButton, menu);
      const coverInput = document.createElement('input');
      coverInput.type = 'file';
      coverInput.accept = 'image/*';
      coverInput.hidden = true;
      coverInput.addEventListener('change', () => {
        const file = coverInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          flashStatus('Choose an image file for the playlist cover.');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 500;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.max(size / image.width, size / image.height);
            const sw = size / scale, sh = size / scale;
            ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, size, size);
            Store.setPlaylistCover(pl.id, canvas.toDataURL('image/jpeg', 0.82));
            renderPlaylists();
          };
          image.onerror = () => flashStatus('That image could not be opened. Try another one.');
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      menuWrap.append(coverInput);
      acts.append(menuWrap);
      head.append(cover, heading, acts);
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

    const createPanel = document.createElement('div');
    createPanel.className = 'picker-create-panel';
    const createInput = document.createElement('input');
    createInput.type = 'text';
    createInput.maxLength = 48;
    createInput.placeholder = 'New playlist name';
    createInput.setAttribute('aria-label', 'New playlist name');
    const createButton = button('Create playlist', () => {
      const name = createInput.value.trim();
      if (!name) {
        createInput.focus();
        return;
      }
      const created = Store.createPlaylist(name);
      if (track) Store.addToPlaylist(created.id, track);
      $('pickerDialog').classList.add('hidden');
      renderPlaylists();
      flashStatus(`Created "${created.name}" and added the song.`);
    }, 'btn primary');
    createInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') createButton.click();
    });
    createPanel.append(createInput, createButton);

    if (!pls.length) {
      const note = document.createElement('p');
      note.className = 'picker-empty-note';
      note.textContent = 'You do not have any playlists yet. Create one here and this song will be added automatically.';
      list.append(note, createPanel);
    } else {
      const note = document.createElement('p');
      note.className = 'picker-empty-note';
      note.textContent = 'Choose a playlist, or make a new one.';
      list.append(note);
      pls.forEach(pl => {
        list.append(button(`${pl.name} · ${pl.tracks.length} songs`, () => {
          Store.addToPlaylist(pl.id, track);
          $('pickerDialog').classList.add('hidden');
          renderPlaylists();
          flashStatus(`Added "${track.title}" to "${pl.name}".`);
        }, 'btn ghost picker-playlist-option'));
      });
      list.append(createPanel);
    }
    $('pickerDialog').classList.remove('hidden');
    $('pickerDialog').setAttribute('aria-hidden', 'false');
    if (!pls.length) requestAnimationFrame(() => createInput.focus());
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

  let draggedQueueIndex = null;
  function renderQueue() {
    const box = $('queueList');
    box.replaceChildren();
    $('queueCount').textContent = state.queue.length;
    if (!state.queue.length) return box.append(emptyNote('Queue is empty. Drag songs here after adding them to your queue.'));
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
      row.classList.add('queue-draggable');
      row.draggable = true;
      row.setAttribute('aria-roledescription', 'Draggable queue item');
      row.addEventListener('dragstart', event => {
        draggedQueueIndex = i;
        row.classList.add('queue-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(i));
      });
      row.addEventListener('dragover', event => {
        if (draggedQueueIndex === null || draggedQueueIndex === i) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('queue-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('queue-drop-target'));
      row.addEventListener('drop', event => {
        if (draggedQueueIndex === null) return;
        event.preventDefault();
        row.classList.remove('queue-drop-target');
        const from = draggedQueueIndex;
        draggedQueueIndex = null;
        if (from !== i) moveQueue(from, i);
      });
      row.addEventListener('dragend', () => {
        draggedQueueIndex = null;
        row.classList.remove('queue-dragging');
        box.querySelectorAll('.queue-drop-target').forEach(el => el.classList.remove('queue-drop-target'));
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

  $('shuffleQueueBtn')?.addEventListener('click', () => {
    const start = Math.max(0, state.currentIndex + 1);
    const upcoming = state.queue.slice(start);
    if (upcoming.length < 2) {
      flashStatus('Add at least two upcoming tracks to shuffle.');
      return;
    }
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    state.queue.splice(start, upcoming.length, ...upcoming);
    saveQueue();
    renderQueue();
    flashStatus('Upcoming tracks shuffled. The current song stays in place.');
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
          const unavailableCodes = [2, 100, 101, 150, 153];
          const detail = {
            2: 'This video ID is invalid.',
            100: 'This video was removed, made private, or is unavailable.',
            101: 'The owner does not allow this song to play in embedded players.',
            150: 'The owner does not allow this song to play in embedded players.',
            153: 'YouTube could not configure playback for this video.',
            5: 'YouTube encountered an HTML5 playback error.'
          }[e.data] || 'YouTube could not play this track.';
          const msg = unavailableCodes.includes(e.data)
            ? 'Song not available — ' + detail
            : 'Unable to play song — ' + detail;
          setPlayingUI(false);
          showPlaybackError(msg);
          const status = $('audioToolsStatus');
          if (status) status.textContent = msg;
        }
      }
    });
  };

  function onPlayerStateChange(e) {
    if (e.data === 1) stopHoverPreview();
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
    window.dispatchEvent(new CustomEvent('resona:track-changed', { detail: { track } }));

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
    const sleepEvent = new Event('resona:track-ended', { cancelable: true });
    window.dispatchEvent(sleepEvent);
    if (sleepEvent.defaultPrevented) { setPlayingUI(false); return; }
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

  // Keep mobile lock-screen / notification media controls in sync with Resona.
  let lastMediaPositionUpdate = 0;
  function updateMediaPosition(force = false) {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const now = Date.now();
    if (!force && now - lastMediaPositionUpdate < 4000) return;
    let duration = 0, position = 0;
    try {
      if (state.audioMode) {
        duration = ResonaAudio.getDuration();
        position = ResonaAudio.getTime();
      } else if (state.playerReady && state.player && state.currentTrack) {
        duration = Number(state.player.getDuration()) || 0;
        position = Number(state.player.getCurrentTime()) || 0;
      }
      if (duration > 0 && Number.isFinite(duration) && Number.isFinite(position)) {
        navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.max(0, Math.min(position, duration)) });
        lastMediaPositionUpdate = now;
      }
    } catch (_) {}
  }

  function syncMediaSession(playing) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      if (state.currentTrack && 'MediaMetadata' in window) {
        const track = state.currentTrack;
        const artwork = track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'Resona',
          artist: track.artist || 'Unknown artist',
          album: 'Resona',
          artwork
        });
      }
      updateMediaPosition(true);
    } catch (_) {}
  }

  if ('mediaSession' in navigator) {
    const actions = {
      play: () => togglePlay(),
      pause: () => {
        if (state.audioMode) ResonaAudio.pause();
        else if (state.playerReady && state.player) state.player.pauseVideo();
      },
      previoustrack: () => playPrev(),
      nexttrack: () => playNext(),
      seekbackward: (details) => {
        const offset = Number(details.seekOffset) || 10;
        if (state.audioMode) ResonaAudio.seek(ResonaAudio.getTime() - offset);
        else if (state.playerReady && state.player) state.player.seekTo(Math.max(0, state.player.getCurrentTime() - offset), true);
        updateMediaPosition(true);
      },
      seekforward: (details) => {
        const offset = Number(details.seekOffset) || 10;
        if (state.audioMode) ResonaAudio.seek(ResonaAudio.getTime() + offset);
        else if (state.playerReady && state.player) state.player.seekTo(state.player.getCurrentTime() + offset, true);
        updateMediaPosition(true);
      },
      seekto: (details) => {
        if (!Number.isFinite(details.seekTime)) return;
        if (state.audioMode) ResonaAudio.seek(details.seekTime);
        else if (state.playerReady && state.player) state.player.seekTo(details.seekTime, true);
        updateMediaPosition(true);
      }
    };
    Object.entries(actions).forEach(([name, handler]) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch (_) {}
    });
  }

  function setPlayingUI(playing) {
    NowPlaying.setPlaying(playing);
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    $('visualizer').classList.toggle('active', playing);
    $('visualizer').classList.toggle('audio-reactive', !!playing && !!state.audioMode);
    syncMediaSession(playing);
  }

  function showNowPlaying(track) {
    $('npTitle').textContent = track.title;
    $('npArtist').textContent = track.artist;
    $('npThumb').src = track.thumbnail || '';
    NowPlaying.setTrack(track);
    syncMediaSession(true);
    setPlayingUI(true);
    updateAlbumBg();
  }

  function applyVolume() {
    const volume = Math.max(0, Math.min(100, Number($('volumeSlider').value)));
    ResonaAudio.setVolume(volume);
    Store.saveSettings({ volume });
    if (state.playerReady) state.player.setVolume(volume);
  }

  // Restore the last chosen volume before the YouTube player becomes ready.
  const savedVolume = Store.getSettings().volume;
  if (savedVolume !== undefined && Number.isFinite(Number(savedVolume))) {
    $('volumeSlider').value = Math.max(0, Math.min(100, Number(savedVolume)));
  }

  $('playBtn').addEventListener('click', togglePlay);
  $('nextBtn').addEventListener('click', playNext);
  $('prevBtn').addEventListener('click', playPrev);
  $('volumeSlider').addEventListener('input', applyVolume);

  // Global playback shortcuts. Text fields and sliders keep their normal keyboard behaviour.
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.altKey || event.metaKey) return;

    if (event.ctrlKey && event.key === 'ArrowRight') {
      event.preventDefault();
      playNext();
      return;
    }
    if (event.ctrlKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      playPrev();
      return;
    }
    if (event.ctrlKey) return;

    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (!state.currentTrack) return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 5 : -5;
      if (state.audioMode) ResonaAudio.seek(ResonaAudio.getTime() + delta);
      else if (state.playerReady) state.player.seekTo(Math.max(0, state.player.getCurrentTime() + delta), true);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const change = event.key === 'ArrowUp' ? 5 : -5;
      $('volumeSlider').value = Math.max(0, Math.min(100, Number($('volumeSlider').value) + change));
      applyVolume();
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      const slider = $('volumeSlider');
      if (Number(slider.value) > 0) {
        Store.saveSettings({ preMuteVolume: Number(slider.value) });
        slider.value = 0;
      } else {
        slider.value = Store.getSettings().preMuteVolume || 80;
      }
      applyVolume();
    }
  });

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
  // Full-screen visualizer: real frequency data for direct audio and captured tab audio.
  const visualizerStage = $('visualizerStage');
  const visualizerCanvas = $('visualizerCanvas');
  const visualizerContext = visualizerCanvas?.getContext('2d');
  let visualStageFrame = 0;
  let visualMode = 'spectrum';
  let visualStageOpen = false;
  let visualStageTick = 0;
  const visualParticles = Array.from({ length: 96 }, (_, index) => ({
    x: ((index * 0.61803398875) % 1),
    y: ((index * 0.7548776662) % 1),
    size: 0.7 + ((index * 7) % 18) / 10,
    speed: 0.15 + ((index * 13) % 30) / 100
  }));
  function visualizerIsPlaying() {
    if (state.audioMode) return ResonaAudio.isPlaying();
    try { return !!(state.playerReady && state.player && state.player.getPlayerState() === 1); }
    catch (_) { return false; }
  }
  function openDynamicVisualizer() {
    if (!visualizerStage) return;
    visualStageOpen = true;
    visualizerStage.classList.remove('hidden');
    visualizerStage.setAttribute('aria-hidden', 'false');
    document.body.classList.add('visualizer-stage-open');
    updateDynamicVisualizerTrack();
    resizeDynamicVisualizer();
    updateDynamicVisualizerSource();
    cancelAnimationFrame(visualStageFrame);
    visualStageFrame = requestAnimationFrame(drawDynamicVisualizer);
  }
  function closeDynamicVisualizer() {
    visualStageOpen = false;
    if (!visualizerStage) return;
    visualizerStage.classList.add('hidden');
    visualizerStage.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('visualizer-stage-open');
    cancelAnimationFrame(visualStageFrame);
  }
  function updateDynamicVisualizerTrack() {
    const track = state.currentTrack;
    $('visualizerTrackTitle').textContent = track?.title || 'Nothing playing';
    $('visualizerTrackArtist').textContent = track?.artist || 'Start a track to begin';
  }
  function updateDynamicVisualizerSource() {
    const status = $('visualizerSourceStatus');
    if (!status) return;
    if (state.audioMode || ResonaAudio.isTabCapturing()) {
      status.textContent = 'LIVE AUDIO ANALYSIS';
      status.classList.add('is-live');
    } else if (state.currentTrack) {
      status.textContent = 'AMBIENT VISUALS · YOUTUBE AUDIO IS ISOLATED';
      status.classList.remove('is-live');
    } else {
      status.textContent = 'PLAY A TRACK TO BEGIN';
      status.classList.remove('is-live');
    }
  }
  function resizeDynamicVisualizer() {
    if (!visualizerCanvas || !visualizerContext) return;
    const rect = visualizerCanvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (visualizerCanvas.width !== width || visualizerCanvas.height !== height) {
      visualizerCanvas.width = width;
      visualizerCanvas.height = height;
      visualizerContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }
  function drawDynamicVisualizer() {
    if (!visualStageOpen || !visualizerContext || !visualizerCanvas) return;
    resizeDynamicVisualizer();
    const ctx = visualizerContext;
    const width = visualizerCanvas.clientWidth;
    const height = visualizerCanvas.clientHeight;
    const playing = visualizerIsPlaying();
    const liveData = (state.audioMode || ResonaAudio.isTabCapturing()) ? ResonaAudio.getFrequencyData() : [];
    const live = liveData.length > 0;
    const energy = live ? liveData.slice(2, 22).reduce((sum, value) => sum + value, 0) / (20 * 255) : (playing ? 0.28 + Math.sin(visualStageTick * 0.035) * 0.12 : 0.06);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#55dfff';
    const warm = getComputedStyle(document.documentElement).getPropertyValue('--warm').trim() || '#f0a064';
    visualStageTick += playing ? 1 : 0.18;
    ctx.clearRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.48, 8, width * 0.5, height * 0.48, Math.max(width, height) * 0.68);
    glow.addColorStop(0, 'rgba(22,105,130,' + (0.12 + energy * 0.2) + ')');
    glow.addColorStop(0.55, 'rgba(8,25,36,0.12)');
    glow.addColorStop(1, 'rgba(2,6,10,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    const count = 72;
    if (visualMode === 'spectrum') {
      const gap = 5;
      const barWidth = Math.max(2, (width - gap * (count - 1)) / count);
      for (let i = 0; i < count; i++) {
        const bin = live ? liveData[Math.min(liveData.length - 1, Math.floor(2 + Math.pow(i / count, 1.8) * liveData.length * 0.72))] / 255 : 0.18 + 0.17 * (0.5 + Math.sin(visualStageTick * 0.045 + i * 0.22));
        const h = Math.max(3, (0.035 + bin * (playing ? 0.78 : 0.12)) * height);
        const x = i * (barWidth + gap);
        const grad = ctx.createLinearGradient(0, height - h, 0, height);
        grad.addColorStop(0, i > count * 0.72 ? warm : accent);
        grad.addColorStop(1, 'rgba(57,139,160,0.12)');
        ctx.fillStyle = grad;
        ctx.shadowBlur = 16;
        ctx.shadowColor = accent;
        ctx.beginPath();
        ctx.roundRect(x, height - h, barWidth, h, barWidth);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else if (visualMode === 'wave') {
      for (let layer = 0; layer < 4; layer++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 3) {
          const index = Math.floor((x / width) * (liveData.length - 1));
          const sample = live ? (liveData[index] / 255 - 0.35) : Math.sin(x * 0.012 + visualStageTick * 0.025 + layer) * 0.35;
          const y = height * (0.5 + layer * 0.045) + Math.sin(x * (0.009 + layer * 0.002) + visualStageTick * (0.018 + layer * 0.006)) * height * (0.12 + energy * 0.2) + sample * height * (live ? 0.22 : 0.08);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = layer % 2 ? warm : accent;
        ctx.globalAlpha = 0.72 - layer * 0.13;
        ctx.lineWidth = 1.5 + (3 - layer) * 0.45;
        ctx.shadowBlur = 18;
        ctx.shadowColor = layer % 2 ? warm : accent;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    } else if (visualMode === 'orb') {
      const cx = width / 2, cy = height / 2;
      const radius = Math.min(width, height) * (0.17 + energy * 0.08);
      for (let ring = 5; ring >= 0; ring--) {
        ctx.beginPath();
        const points = 220;
        for (let i = 0; i <= points; i++) {
          const angle = i / points * Math.PI * 2;
          const bin = live ? liveData[Math.min(liveData.length - 1, Math.floor(i / points * liveData.length))] / 255 : 0.5 + 0.5 * Math.sin(angle * 5 + visualStageTick * 0.03);
          const r = radius + ring * 13 + bin * (live ? 34 : 16) * (playing ? 1 : 0.2);
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r * 0.78;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = ring % 2 ? warm : accent;
        ctx.globalAlpha = 0.78 - ring * 0.1;
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 18;
        ctx.shadowColor = ring % 2 ? warm : accent;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      const core = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.3, 2, cx, cy, radius * 1.15);
      core.addColorStop(0, 'rgba(177,245,255,0.9)');
      core.addColorStop(0.3, accent);
      core.addColorStop(1, 'rgba(13,49,68,0.12)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const cx = width / 2, cy = height / 2;
      visualParticles.forEach((particle, index) => {
        const drift = visualStageTick * particle.speed * (playing ? 0.6 : 0.08);
        const x = ((particle.x * width + Math.sin(drift + index) * 32) % width + width) % width;
        const y = ((particle.y * height - drift * 18) % height + height) % height;
        const size = particle.size * (1 + energy * 1.8);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = index % 7 === 0 ? warm : accent;
        ctx.globalAlpha = 0.25 + energy * 0.55;
        ctx.shadowBlur = 12;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        if (index % 4 === 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(cx + (x - cx) * 0.18, cy + (y - cy) * 0.18);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.globalAlpha *= 0.25;
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    visualStageFrame = requestAnimationFrame(drawDynamicVisualizer);
  }
  $('visualizerOpenBtn')?.addEventListener('click', openDynamicVisualizer);
  $('visualizerCloseBtn')?.addEventListener('click', closeDynamicVisualizer);
  visualizerStage?.addEventListener('click', event => { if (event.target === visualizerStage) closeDynamicVisualizer(); });
  visualizerStage?.querySelectorAll('[data-visual-mode]').forEach(button => button.addEventListener('click', () => {
    visualMode = button.dataset.visualMode;
    visualizerStage.querySelectorAll('[data-visual-mode]').forEach(item => item.classList.toggle('active', item === button));
  }));
  window.addEventListener('resize', resizeDynamicVisualizer);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && visualStageOpen) closeDynamicVisualizer(); });
  window.addEventListener('resona:track-changed', () => {
    updateDynamicVisualizerTrack();
    updateDynamicVisualizerSource();
  });
  window.addEventListener('resona:audio-play', updateDynamicVisualizerSource);
  window.addEventListener('resona:tab-capture-start', updateDynamicVisualizerSource);
  window.addEventListener('resona:tab-capture-stop', updateDynamicVisualizerSource);
  window.addEventListener('resona:audio-pause', updateDynamicVisualizerSource);

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
    updateMediaPosition(true);
    cancelAnimationFrame(visualizerFrame);
    visualizerFrame = requestAnimationFrame(animateAudioVisualizer);
  });
  window.addEventListener('resona:audio-timeupdate', () => updateMediaPosition());
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


  // ---------- Playback error popup ----------

  function showPlaybackError(message) {
    const dialog = $('playbackErrorDialog');
    const text = $('playbackErrorMessage');
    if (!dialog || !text) {
      flashStatus(message);
      return;
    }
    text.textContent = message;
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    $('closePlaybackError')?.focus();
  }

  function closePlaybackError() {
    const dialog = $('playbackErrorDialog');
    if (!dialog) return;
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
  }

  $('closePlaybackError')?.addEventListener('click', closePlaybackError);
  $('playbackErrorDialog')?.addEventListener('click', event => {
    if (event.target === $('playbackErrorDialog')) closePlaybackError();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('playbackErrorDialog') && !$('playbackErrorDialog').classList.contains('hidden')) {
      closePlaybackError();
    }
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
