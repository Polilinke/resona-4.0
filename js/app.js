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
    lastQuery: ''
  };

  // ---------- Settings, theme, accent, glass, album background ----------
  function applySettings() {
    const s = Store.getSettings();
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.dataset.accent = s.accent;
    $('accentSelect').value = s.accent;
    document.body.classList.toggle('glass', !!s.glass);
    const nowPlaying = $('npFull');
    if (nowPlaying) nowPlaying.classList.toggle('lyrics-glass', !!s.npGlass);
    updateAlbumBg();
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

  $('accentSelect').addEventListener('change', (e) => {
    Store.saveSettings({ accent: e.target.value });
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
    if (state.isSearch) {
      const count = state.results.length;
      $('searchStatus').textContent = officialOnlyToggle.checked
        ? (count ? `Showing ${count} likely official music result(s).` : 'No likely official upload found. Turn off Official only to see all results.')
        : `Showing all ${count} search result(s).`;
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
    showView('search');

    const cached = Store.getCachedSearch(query);
    if (cached) {
      state.rawResults = cached;
      state.isSearch = true;
      renderResults();
      $('searchStatus').textContent = officialOnlyToggle.checked
        ? (state.results.length ? `Showing ${state.results.length} likely official cached result(s) for "${query}".` : 'No likely official upload found. Turn off Official only to see all results.')
        : `Showing all ${state.results.length} cached results for "${query}".`;
      return;
    }

    $('searchStatus').textContent = `Searching for "${query}"…`;
    try {
      const results = await YouTubeAPI.search(query);
      Store.setCachedSearch(query, results);
      state.rawResults = results;
      state.isSearch = true;
      renderResults();
      $('searchStatus').textContent = officialOnlyToggle.checked
        ? (state.results.length ? `Showing ${state.results.length} likely official result(s) for "${query}".` : 'No likely official upload found. Turn off Official only to see all results.')
        : (results.length ? `Showing all ${results.length} results for "${query}".` : `No results for "${query}".`);
    } catch (err) {
      if (err instanceof YouTubeAPI.QuotaExhaustedError) {
        $('searchStatus').textContent = 'YouTube says the quota is used up. Fresh searches will resume after the daily reset.';
      } else {
        $('searchStatus').textContent = 'Search failed: ' + err.message;
      }
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
    info.style.minWidth = '0';
    const t = document.createElement('div');
    t.className = 'track-title';
    t.textContent = track.title;
    t.title = track.title;
    const a = document.createElement('div');
    a.className = 'track-artist';
    a.textContent = track.artist;
    info.append(t, a);

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
      button('▶ Play', () => {
        if (track.source === 'local-audio') {
          $('audioToolsDialog').classList.remove('hidden');
          $('audioToolsDialog').setAttribute('aria-hidden', 'false');
          $('audioToolsStatus').textContent = 'Choose the original file again to play this local track.';
          $('audioFileInput').click();
        } else {
          playFromList(opts.list || [track], track);
        }
      }, 'btn small primary'),
      button('+ Queue', () => addToQueue(track), 'btn small'),
      button(Store.isSaved(track.id) ? '★ Saved' : '☆ Save', () => {
        if (Store.isSaved(track.id)) Store.removeTrack(track.id);
        else Store.saveTrack(track);
        refreshCurrent();
      }, 'btn small'),
      button('Add to playlist', () => openPicker(track), 'btn small ghost')
    );
    if (opts.removable) {
      actions.append(button('Remove', () => opts.removable(track), 'btn small danger'));
    }

    row.append(img, info, actions);
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
    state.results = state.isSearch && officialOnlyToggle.checked
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

  function playQueueIndex(i) {
    if (i < 0 || i >= state.queue.length) return;
    state.currentIndex = i;
    state.audioMode = false;
    ResonaAudio.stop();
    const track = state.queue[i];
    state.currentTrack = track;
    Store.addToHistory(track);
    showNowPlaying(track);
    if (state.playerReady) state.player.loadVideoById(track.id);
    else state.pendingVideoId = track.id;
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

  function setPlayingUI(playing) {
    NowPlaying.setPlaying(playing);
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    $('visualizer').classList.toggle('active', playing);
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
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\.0$/, '') + ' dB';
    });
  }
  document.querySelectorAll('[data-eq-band]').forEach(input => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.eqBand);
      ResonaAudio.setBand(index, Number(input.value));
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\.0$/, '') + ' dB';
      $('eqPreset').value = 'custom';
    });
  });
  $('eqPreset').addEventListener('change', () => {
    if ($('eqPreset').value === 'custom') return;
    const values = ResonaAudio.applyPreset($('eqPreset').value);
    document.querySelectorAll('[data-eq-band]').forEach(input => {
      input.value = values[Number(input.dataset.eqBand)];
      input.parentElement.querySelector('output').textContent = Number(input.value).toFixed(1).replace(/\.0$/, '') + ' dB';
    });
  });
  $('eqReset').addEventListener('click', () => {
    $('eqPreset').value = 'flat';
    const values = ResonaAudio.applyPreset('flat');
    document.querySelectorAll('[data-eq-band]').forEach(input => {
      input.value = values[Number(input.dataset.eqBand)];
      input.parentElement.querySelector('output').textContent = '0 dB';
    });
  });
  $('audioToolsDialog').addEventListener('click', event => {
    if (event.target === $('audioToolsDialog')) {
      $('audioToolsDialog').classList.add('hidden');
      $('audioToolsDialog').setAttribute('aria-hidden', 'true');
    }
  });
  window.addEventListener('resona:audio-play', () => { if (state.audioMode) setPlayingUI(true); });
  window.addEventListener('resona:audio-pause', () => { if (state.audioMode) setPlayingUI(false); });
  ResonaAudio.onTrackEnded(() => {
    if (!state.audioMode) return;
    $('audioToolsStatus').textContent = 'Track finished.';
    if (state.queue.length) playQueueIndex(0);
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

  // ---------- Background (see js/background.js) ----------
  const backgroundChoice = $('backgroundChoice');
  const closeBackgroundChoice = () => backgroundChoice.classList.add('hidden');
  $('chooseAppBackground').addEventListener('click', () => {
    localStorage.setItem('resona-background-choice', 'app');
    closeBackgroundChoice();
    Background.useDefaultBackground();
  });
  $('chooseOwnBackground').addEventListener('click', () => {
    closeBackgroundChoice();
    $('bgFileInput').click();
  });

  $('bgFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!Background.chooseFile(file)) {
        e.target.value = '';
        $('freshBgToggle').checked = false;
        $('bgEnabled').checked = false;
        Background.setEnabled(false);
        backgroundChoice.classList.remove('hidden');
      } else {
        localStorage.setItem('resona-background-choice', 'own');
        $('freshBgToggle').checked = true;
        $('bgEnabled').checked = true;
      }
    } else if (!Background.hasSource()) {
      backgroundChoice.classList.remove('hidden');
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
      backgroundChoice.classList.remove('hidden');
      return;
    }
    Background.setEnabled(enabled);
  });

  // ---------- Settings dialog ----------
  $('settingsBtn').addEventListener('click', () => {
    const s = Store.getSettings();
    $('sizeSelect').value = s.windowSize;
    $('regionSelect').value = s.popularRegion || 'US';
    $('albumBgToggle').checked = !!s.albumBg;
    $('glassToggle').checked = !!s.glass;
    $('npGlassToggle').checked = !!s.npGlass;
    $('customAccent').value = s.customAccent || '#22d3ee';
    $('glassIntensity').value = s.glassIntensity || 12;
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

  $('closeSettingsBtn').addEventListener('click', () => {
    const size = $('sizeSelect').value;
    Store.saveSettings({
      windowSize: size,
      popularRegion: $('regionSelect').value,
      customAccent: $('customAccent').value,
      glassIntensity: Number($('glassIntensity').value)
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

  // ---------- Backup ----------
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      Store.importAll(JSON.parse(await file.text()));
      state.queue = Store.getQueue();
      saveQueue();
      flashStatus('Backup imported.');
      refreshCurrent();
    } catch (err) {
      flashStatus('Import failed: ' + err.message);
    }
    e.target.value = '';
  });

  NowPlaying.init({
    getTime: () => (state.audioMode ? ResonaAudio.getTime() : (state.playerReady ? state.player.getCurrentTime() : 0)),
    getDuration: () => (state.audioMode ? ResonaAudio.getDuration() : (state.playerReady ? state.player.getDuration() : 0)),
    seek: (t) => { if (state.audioMode) ResonaAudio.seek(t); else if (state.playerReady) state.player.seekTo(t, true); },
    toggle: togglePlay,
    next: playNext,
    prev: playPrev
  });

  // Full-page ambient spotlight follows the cursor, not just individual cards.
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    document.documentElement.style.setProperty('--pointer-x', event.clientX + 'px');
    document.documentElement.style.setProperty('--pointer-y', event.clientY + 'px');
    document.body.classList.add('pointer-active');
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
