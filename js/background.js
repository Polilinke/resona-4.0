// Background module: base colour (bottom), album artwork (middle), MP4 video (top of the background).
// The interface sits above all three layers.
const Background = (() => {
  const $ = (id) => document.getElementById(id);
  const MEDIA_ERRORS = {
    1: 'loading was stopped',
    2: 'network error reading the file',
    3: 'the file could not be decoded (try re-exporting as H.264 MP4)',
    4: 'the file format or codec is not supported'
  };

  let currentArt = '';
  let blobUrl = null;
  const DB_NAME = 'deepflow-media';
  const DB_STORE = 'backgrounds';

  function openMediaDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable in this browser.'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
    });
  }

  async function saveBackgroundFile(file) {
    const db = await openMediaDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ blob: file, name: file.name, savedAt: Date.now() }, 'mp4');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Could not save MP4.'));
      tx.onabort = () => reject(tx.error || new Error('MP4 save was cancelled.'));
    });
    db.close();
  }

  async function loadSavedBackground() {
    const db = await openMediaDb();
    const saved = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get('mp4');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Could not read saved MP4.'));
    });
    db.close();
    if (saved && saved.blob) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(saved.blob);
      loadSource(blobUrl);
      applyMode();
      setStatus(`Restored saved background: ${saved.name || 'MP4'}`);
      return true;
    }
    return false;
  }

  function setStatus(text) {
    const el = $('bgStatus');
    if (el) el.textContent = text;
  }

  function toFileUrl(p) {
    return new URL('file:///' + p.replace(/\\/g, '/')).href;
  }

  // Decides which layers are visible, based on settings and the video's state
  function applyMode() {
    const s = Store.getSettings();
    const v = $('bgVideo');
    const hasSource = !!v.getAttribute('src');
    const showVideo = !!s.bgEnabled && hasSource && !v.error;

    document.body.classList.toggle('video-on', showVideo);
    v.classList.toggle('hidden', !showVideo);
    if (showVideo) {
      v.play().catch((e) => setStatus('Playback was blocked: ' + e.message));
    } else {
      v.pause();
    }

    const art = $('albumBg');
    const showArt = !showVideo && !!s.albumBg && !!currentArt;
    art.classList.toggle('on', showArt);
  }

  // Called by the app whenever the current track changes
  function setArt(url) {
    currentArt = url || '';
    if (currentArt) {
      $('albumBg').style.backgroundImage = `url("${currentArt.replace(/"/g, '')}")`;
    }
    applyMode();
  }

  // Called when the user picks a file in Settings
  function chooseFile(file) {
    const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    if (!isMp4) {
      setStatus('Only .mp4 files are supported.');
      return false;
    }
    const path = window.desktop && window.desktop.getFilePath ? window.desktop.getFilePath(file) : '';
    if (path) {
      Store.saveSettings({ bgPath: path, bgEnabled: true });
      loadSource(toFileUrl(path));
    } else {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(file);
      Store.saveSettings({ bgEnabled: true });
      loadSource(blobUrl);
      saveBackgroundFile(file).then(() => setStatus(`Saved ${file.name} in this browser.`)).catch(err => setStatus(`Video loaded for this session, but could not be saved: ${err.message}`));
    }
    $('bgEnabled').checked = true;
    applyMode();
    return true;
  }

  function hasSource() {
    const v = $('bgVideo');
    return !!(v && (v.getAttribute('src') || v.currentSrc));
  }

  function setEnabled(on) {
    Store.saveSettings({ bgEnabled: !!on });
    applyMode();
  }

  function loadSource(src) {
    const v = $('bgVideo');
    v.src = src;
    v.load();
  }

  function init() {
    const v = $('bgVideo');
    v.addEventListener('loadstart', () => setStatus('Loading video…'));
    v.addEventListener('loadeddata', () => setStatus('Video loaded.'));
    v.addEventListener('playing', () => setStatus('Background video is playing.'));
    v.addEventListener('error', () => {
      const code = v.error ? v.error.code : 0;
      setStatus('Video error: ' + (MEDIA_ERRORS[code] || 'unknown problem') + '.');
      applyMode();
    });

    const s = Store.getSettings();
    if (s.bgPath && window.desktop) loadSource(toFileUrl(s.bgPath));
    else loadSavedBackground().catch(err => setStatus('No saved browser video could be restored: ' + err.message));
    applyMode();
  }

  return { init, chooseFile, setEnabled, setArt, applyMode, hasSource };
})();
