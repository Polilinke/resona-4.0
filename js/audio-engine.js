// Resona Audio Engine: local-file playback and real-time 10-band equalization.
(() => {
  const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    flat: [0,0,0,0,0,0,0,0,0,0],
    bass: [7,6,5,3,1,0,0,0,0,0],
    treble: [0,0,0,0,0,1,3,5,6,7],
    vocal: [-2,-1,0,1,3,4,3,1,0,-1],
    rock: [5,4,2,0,-1,1,3,4,4,4],
    electronic: [5,4,1,-2,-1,2,1,3,4,5],
    classical: [4,3,2,1,-1,-1,0,2,3,4]
  };
  const STORAGE_KEY = 'resona-eq-settings-v1';
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = 0.8;
  let context = null, filters = [], source = null, objectUrl = null, onEnded = () => {}, currentFile = null;

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return Array.isArray(saved) && saved.length === FREQUENCIES.length
        ? saved.map(v => Math.max(-12, Math.min(12, Number(v) || 0)))
        : PRESETS.flat.slice();
    } catch (_) { return PRESETS.flat.slice(); }
  }
  function saveSettings(values) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_) {} }

  function ensureGraph() {
    if (context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio API.');
    context = new AudioContextClass();
    source = context.createMediaElementSource(audio);
    const initial = readSettings();
    filters = FREQUENCIES.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = initial[index];
      return filter;
    });
    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(context.destination);
  }
  function setBand(index, gain) {
    if (!Number.isInteger(index) || index < 0 || index >= FREQUENCIES.length) return;
    ensureGraph();
    const value = Math.max(-12, Math.min(12, Number(gain) || 0));
    filters[index].gain.setTargetAtTime(value, context.currentTime, 0.015);
    const values = filters.map(filter => filter.gain.value);
    values[index] = value;
    saveSettings(values);
  }
  function applyPreset(name) {
    const values = PRESETS[name] || PRESETS.flat;
    ensureGraph();
    values.forEach((gain, index) => filters[index].gain.setTargetAtTime(gain, context.currentTime, 0.015));
    saveSettings(values);
    return values.slice();
  }
  function getBands() { return filters.length ? filters.map(filter => filter.gain.value) : readSettings(); }
  function loadFile(file) {
    if (!file || !(file.type.startsWith('audio/') || /.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(file.name))) {
      throw new Error('Choose a supported audio file.');
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    audio.pause();
    ensureGraph();
    audio.removeAttribute('crossorigin');
    objectUrl = URL.createObjectURL(file);
    currentFile = file;
    audio.src = objectUrl;
    audio.load();
    return { name: file.name, size: file.size, type: file.type };
  }
  function loadUrl(url) {
    if (!url || typeof url !== 'string') throw new Error('Audius did not provide a playable stream URL.');
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    audio.pause();
    ensureGraph();
    currentFile = null;
    audio.crossOrigin = 'anonymous';
    audio.src = url;
    audio.load();
    return { url };
  }
  async function play() {
    ensureGraph();
    if (context.state === 'suspended') await context.resume();
    await audio.play();
  }
  function pause() { audio.pause(); }
  function toggle() { return audio.paused ? play() : pause(); }
  function stop() { audio.pause(); if (audio.src) audio.currentTime = 0; }
  function seek(seconds) {
    if (Number.isFinite(seconds) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
  }
  function setVolume(value) { audio.volume = Math.max(0, Math.min(1, Number(value) / 100)); }
  function getTime() { return Number.isFinite(audio.currentTime) ? audio.currentTime : 0; }
  function getDuration() { return Number.isFinite(audio.duration) ? audio.duration : 0; }
  function onTrackEnded(callback) { onEnded = typeof callback === 'function' ? callback : () => {}; }
  audio.addEventListener('play', () => window.dispatchEvent(new Event('resona:audio-play')));
  audio.addEventListener('pause', () => window.dispatchEvent(new Event('resona:audio-pause')));
  audio.addEventListener('ended', () => onEnded());
  audio.addEventListener('error', () => window.dispatchEvent(new CustomEvent('resona:audio-error', {
    detail: { message: 'This file could not be decoded or played by your browser.' }
  })));
  window.ResonaAudio = { frequencies:FREQUENCIES.slice(), presets:Object.keys(PRESETS), loadFile, loadUrl, play, pause, toggle, stop, seek, setVolume, getTime, getDuration, isPlaying:() => !audio.paused, getCurrentFile:() => currentFile, setBand, applyPreset, getBands, onTrackEnded };
})();
