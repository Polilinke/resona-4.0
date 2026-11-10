// Expanded "now playing" view: artwork, title, artist, album, progress, and lyrics.
// Lyrics and album come from lrclib.net (free, no key). Lyrics are fetched only
// for the current track and kept in memory for this session.
const NowPlaying = (() => {
  const $ = (id) => document.getElementById(id);
  const LYRICS_API = 'https://lrclib.net/api/search?q=';

  let track = null;
  let playing = false;
  let lines = [];          // { t: seconds | null, text }
  let synced = false;
  let activeIdx = -1;
  let manualIdx = -1;
  let lyricOffset = 0;
  let requestId = 0;
  let timer = null;
  let opts = {};
  const cache = new Map(); // videoId -> lyrics result (session only)

  // Parses LRC text: "[01:23.45] line"
  function parseLrc(text) {
    const out = [];
    for (const raw of text.split('\n')) {
      const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // Strips "(Official Video)", "[Lyrics]" and similar noise from YouTube titles
  function cleanTitle(title) {
    return title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(official|music|video|lyrics?|audio|hd|4k|visualizer)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async function findLyrics(tr) {
    if (cache.has(tr.id)) return cache.get(tr.id);
    const res = await fetch(LYRICS_API + encodeURIComponent(cleanTitle(tr.title)));
    if (!res.ok) throw new Error('lyrics service returned ' + res.status);
    const list = await res.json();
    const hit = list.find((r) => r.syncedLyrics && !r.instrumental)
             || list.find((r) => r.plainLyrics && !r.instrumental)
             || null;
    cache.set(tr.id, hit);
    return hit;
  }

  function renderInfo() {
    $('npFullTitle').textContent = track ? track.title : 'Nothing playing';
    $('npFullArtist').textContent = track ? track.artist : '';
    $('npFullArt').src = track && track.thumbnail ? track.thumbnail : '';
    const dockTitle = $('npDockTitle');
    const dockArtist = $('npDockArtist');
    if (dockTitle) dockTitle.textContent = track ? track.title : 'Nothing playing';
    if (dockArtist) dockArtist.textContent = track ? track.artist : 'Search for a track to begin';
  }

  function syncVisualizerLyrics() {
    const box = $('visualizerLyrics');
    const status = $('visualizerLyricsStatus');
    if (!box || !status) return;
    box.textContent = '';
    const sourceStatus = $('npLyricsStatus');
    status.textContent = sourceStatus ? sourceStatus.textContent : '';
    lines.forEach((line, i) => {
      const row = document.createElement('p');
      row.className = 'visualizer-lyric-line' + (i === activeIdx ? ' active' : '');
      row.textContent = line.text || '\u00a0';
      row.dataset.i = i;
      row.addEventListener('click', () => jumpToLyric(i));
      box.appendChild(row);
    });
    const active = box.querySelector('.visualizer-lyric-line.active');
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function renderLyrics(list, isSynced) {
    const box = $('npLyrics');
    box.textContent = '';
    lines = list;
    synced = isSynced;
    activeIdx = -1;
    manualIdx = -1;
    list.forEach((line, i) => {
      const p = document.createElement('p');
      p.className = 'lyric-line';
      p.dataset.i = i;
      p.textContent = line.text || '\u00a0';
      p.addEventListener('click', () => jumpToLyric(i));
      box.appendChild(p);
    });
    syncVisualizerLyrics();
  }

  function setActiveLyric(idx) {
    if (!lines.length) return;
    activeIdx = Math.max(0, Math.min(lines.length - 1, idx));
    const box = $('npLyrics');
    box.querySelectorAll('.lyric-line.active').forEach((el) => el.classList.remove('active'));
    const el = box.querySelector(`.lyric-line[data-i="${activeIdx}"]`);
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const mirror = $('visualizerLyrics');
    if (mirror) {
      mirror.querySelectorAll('.visualizer-lyric-line.active').forEach(node => node.classList.remove('active'));
      const mirrorLine = mirror.querySelector(`.visualizer-lyric-line[data-i="${activeIdx}"]`);
      if (mirrorLine) {
        mirrorLine.classList.add('active');
        mirrorLine.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function jumpToLyric(idx) {
    if (!lines.length) return;
    const next = Math.max(0, Math.min(lines.length - 1, idx));
    manualIdx = next;
    setActiveLyric(next);
    if (synced && lines[next].t != null && opts.seek) opts.seek(Math.max(0, lines[next].t - lyricOffset));
  }

  function moveLyric(delta) {
    if (!lines.length) return;
    const base = activeIdx >= 0 ? activeIdx : 0;
    jumpToLyric(base + delta);
  }

  function highlight() {
    if (!synced || !lines.length || !opts.getTime) return;
    const now = opts.getTime() + lyricOffset;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= now + 0.2) idx = i; else break;
    }
    if (idx === activeIdx) return;
    setActiveLyric(idx);
  }

  function tick() {
    if (!opts.getTime) return;
    const now = opts.getTime();
    const dur = opts.getDuration ? opts.getDuration() : 0;
    $('npFullTime').textContent = fmt(now);
    $('npFullDur').textContent = fmt(dur);
    if (dur > 0 && document.activeElement !== $('npFullSeek')) {
      $('npFullSeek').value = Math.round((now / dur) * 1000);
    }
    highlight();
  }

  async function setTrack(tr) {
    track = tr;
    lyricOffset = tr ? Number(localStorage.getItem('deepflow.lyricOffset.' + tr.id) || 0) : 0;
    renderInfo();
    $('npFullAlbum').textContent = 'Album: loading…';
    const id = ++requestId;
    $('npLyrics').textContent = '';
    lines = [];
    synced = false;
    activeIdx = -1;
    manualIdx = -1;
    $('npLyricsStatus').textContent = 'Loading lyrics…';
    syncVisualizerLyrics();
    updateOffsetLabel();
    if (!tr) return;
    try {
      const hit = await findLyrics(tr);
      if (id !== requestId) return; // a newer track has started
      if (!hit) {
        $('npLyricsStatus').textContent = 'No lyrics found for this track.';
        syncVisualizerLyrics();
        $('npFullAlbum').textContent = 'Album: not available';
        return;
      }
      $('npFullAlbum').textContent = 'Album: ' + (hit.albumName || 'not available');
      if (hit.syncedLyrics) {
        renderLyrics(parseLrc(hit.syncedLyrics), true);
        $('npLyricsStatus').textContent = '';
        syncVisualizerLyrics();
      } else {
        renderLyrics(hit.plainLyrics.split('\n').map((t) => ({ t: null, text: t })), false);
        $('npLyricsStatus').textContent = 'Lyrics are not time-synced for this track.';
        syncVisualizerLyrics();
      }
    } catch (err) {
      if (id !== requestId) return;
      $('npLyricsStatus').textContent = 'Could not load lyrics: ' + err.message;
        syncVisualizerLyrics();
      $('npFullAlbum').textContent = 'Album: not available';
    }
  }

  function updateOffsetLabel() {
    const el = $('npLyricOffsetValue');
    if (el) el.textContent = `${lyricOffset >= 0 ? '+' : ''}${lyricOffset.toFixed(1)}s`;
  }

  function adjustOffset(delta) {
    if (!track) return;
    lyricOffset = Math.max(-10, Math.min(10, Math.round((lyricOffset + delta) * 10) / 10));
    localStorage.setItem('deepflow.lyricOffset.' + track.id, String(lyricOffset));
    updateOffsetLabel();
    highlight();
  }

  function setPlaying(p) {
    playing = p;
    $('npFullPlay').textContent = p ? '❚❚' : '▶';
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open() {
    if (!track) return;
    const topbar = document.querySelector('.topbar');
    const top = topbar ? topbar.getBoundingClientRect().bottom : 0;
    const view = $('npFull');
    view.style.setProperty('--np-top-offset', top + 'px');
    view.style.top = top + 'px';
    view.style.height = 'calc(100dvh - ' + top + 'px)';
    view.classList.remove('hidden');
    window.dispatchEvent(new Event('resona:np-open'));
    view.setAttribute('aria-hidden', 'false');
    renderInfo();
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 250);
    document.addEventListener('keydown', onKey);
  }

  function close() {
    const view = $('npFull');
    view.classList.add('hidden');
    window.dispatchEvent(new Event('resona:np-close'));
    view.setAttribute('aria-hidden', 'true');
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
  }

  function init(callbacks) {
    opts = callbacks;
    $('npOpen').addEventListener('click', open);
    $('npOpen').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    $('npClose').addEventListener('click', close);
    $('npLyricPrev').addEventListener('click', () => moveLyric(-1));
    $('npLyricNext').addEventListener('click', () => moveLyric(1));
    $('npLyricOffsetMinus').addEventListener('click', () => adjustOffset(-0.5));
    $('npLyricOffsetPlus').addEventListener('click', () => adjustOffset(0.5));
    $('npLyricsBlack').addEventListener('click', () => {
      const enabled = $('npFull').classList.toggle('lyrics-black');
      $('npLyricsBlack').setAttribute('aria-pressed', String(enabled));
      $('npLyricsBlack').classList.toggle('active', enabled);
    });
    $('npFullPlay').addEventListener('click', () => opts.toggle && opts.toggle());
    $('npFullNext').addEventListener('click', () => opts.next && opts.next());
    $('npFullPrev').addEventListener('click', () => opts.prev && opts.prev());
    $('npDockEq')?.addEventListener('click', () => $('eqBtn')?.click());
    $('npFullSeek').addEventListener('change', (e) => {
      const dur = opts.getDuration ? opts.getDuration() : 0;
      if (dur > 0 && opts.seek) opts.seek((Number(e.target.value) / 1000) * dur);
    });
  }

  return { init, setTrack, setPlaying, open, close, _parseLrc: parseLrc, _cleanTitle: cleanTitle };
})();
