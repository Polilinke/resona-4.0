// DeepFlow browser features: local insights, recommendations, sleep timer and theme studio.
// These features use local data and do not call the YouTube Data API.
(() => {
  const $ = (id) => document.getElementById(id);
  let sleepTimeout = null;
  let sleepInterval = null;
  let sleepDeadline = 0;
  let sleepAtTrackEnd = false;

  function history() { return Store.getHistory(); }
  function fmtMinutes(ms) { return Math.max(0, Math.round(ms / 60000)); }
  function makeCard(label, value, note) {
    const el = document.createElement('div'); el.className = 'insight-card';
    const small = document.createElement('div'); small.className = 'hint'; small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = note;
    el.append(small, strong, p); return el;
  }
  function trackItem(track, action) {
    const row = document.createElement('div'); row.className = 'feature-track';
    const img = document.createElement('img'); img.src = track.thumbnail || ''; img.alt = '';
    const info = document.createElement('div'); info.className = 'feature-track-info';
    const title = document.createElement('strong'); title.textContent = track.title || 'Unknown track';
    const artist = document.createElement('span'); artist.textContent = track.artist || 'Unknown artist';
    info.append(title, artist);
    const btn = document.createElement('button'); btn.className = 'btn small'; btn.textContent = 'Queue'; btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('deepflow:queue-track', { detail: track })));
    row.append(img, info, btn); return row;
  }
  function renderInsights() {
    const list = history();
    renderWeeklyGoal(list);
    renderRecentSearches();
    renderTimeline(list);
    const counts = new Map();
    list.forEach(t => { const key = t.id; const old = counts.get(key) || { track: t, count: 0, last: t.playedAt || 0 }; old.count++; old.last = Math.max(old.last, t.playedAt || 0); counts.set(key, old); });
    const ranked = [...counts.values()].sort((a,b) => b.count-a.count);
    const artists = new Set(list.map(t => t.artist).filter(Boolean));
    const recent = list.filter(t => Date.now() - (t.playedAt || 0) < 7*86400000);
    const stats = $('insightsStats'); stats.replaceChildren(
      makeCard('Tracks played', String(list.length), 'Recorded play starts'),
      makeCard('Different tracks', String(counts.size), 'Unique video IDs'),
      makeCard('Artists explored', String(artists.size), 'Based on available track metadata'),
      makeCard('Last 7 days', String(recent.length), 'Play starts in the past week')
    );
    const top = $('topTracks'); top.replaceChildren();
    if (!ranked.length) top.textContent = 'Play some music and your insights will appear here.';
    ranked.slice(0,8).forEach(x => { const item = trackItem(x.track); item.querySelector('button').textContent = `${x.count} plays`; item.querySelector('button').disabled = true; top.append(item); });
    renderRecommendations();
  }
  function renderRecommendations() {
    const box = $('recommendations'); box.replaceChildren();
    const seed = history()[0] || Store.getLibrary()[0];
    const pool = [...Store.getLibrary(), ...history()].filter(t => t && t.id !== (seed && seed.id));
    const seen = new Set();
    const ranked = pool.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }).map(t => ({t, score: (seed && t.artist && seed.artist && t.artist.toLowerCase() === seed.artist.toLowerCase() ? 3 : 0) + (seed && t.title && seed.title && t.title.toLowerCase().split(' ').some(w => w.length > 4 && seed.title.toLowerCase().includes(w)) ? 1 : 0)})).sort((a,b)=>b.score-a.score);
    if (!ranked.length) { box.textContent = 'Save or play a few tracks first. Recommendations are generated from your local library and history.'; return; }
    ranked.slice(0,8).forEach(x => box.append(trackItem(x.t)));
  }

  function renderWeeklyGoal(list) {
    const goal = Math.max(1, Math.min(500, Number(Store.getSettings().weeklyPlayGoal) || 30));
    $('weeklyGoalInput').value = goal;
    const start = new Date();
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const plays = (list || history()).filter(t => (t.playedAt || 0) >= start.getTime()).length;
    $('weeklyGoalProgress').style.width = Math.min(100, Math.round(plays / goal * 100)) + '%';
    $('weeklyGoalLabel').textContent = plays + ' of ' + goal + ' play starts this week';
  }

  const MOOD_TERMS = {
    focus: ['focus','study','instrumental','piano','ambient','classical','soundtrack','lofi','lo-fi'],
    chill: ['chill','acoustic','soft','calm','relax','ambient','slow','jazz','lofi','lo-fi'],
    energetic: ['dance','rock','metal','workout','edm','remix','upbeat','party','energy','pop'],
    night: ['night','drive','midnight','city','synthwave','synth','dream','ambient','late'],
    classical: ['classical','piano','orchestra','symphony','sonata','concerto','mozart','beethoven','chopin','bach'],
    happy: ['happy','feel good','summer','sunshine','upbeat','pop','dance','celebration']
  };
  function buildMoodQueue() {
    const mood = $('moodSelect').value;
    const all = [...Store.getLibrary(), ...history()];
    const unique = new Map();
    all.forEach(track => { if (track && track.id && !unique.has(track.id)) unique.set(track.id, track); });
    const terms = MOOD_TERMS[mood] || [];
    const ranked = [...unique.values()].map(track => {
      const haystack = ((track.title || '') + ' ' + (track.artist || '') + ' ' + (track.album || '')).toLowerCase();
      return { track, score: terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) };
    }).sort((a,b) => b.score - a.score);
    const matches = ranked.filter(x => x.score > 0).map(x => x.track);
    const chosen = matches.length ? matches : ranked.slice(0,8).map(x => x.track);
    if (!chosen.length) {
      $('moodStatus').textContent = 'Play or save some tracks first. Mood queues use only your existing music.';
      return;
    }
    chosen.slice(0,15).forEach(track => window.dispatchEvent(new CustomEvent('deepflow:queue-track', { detail: track })));
    $('moodStatus').textContent = matches.length
      ? 'Added ' + Math.min(15,matches.length) + ' locally matched tracks for ' + mood + '.'
      : 'No clear ' + mood + ' matches yet, so we added a mix from your existing music.';
  }

  function renderRecentSearches() {
    const box = $('recentSearchesList');
    if (!box) return;
    box.replaceChildren();
    const items = Store.getRecentSearches();
    if (!items.length) {
      const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Your searches will appear here.';
      box.append(note); return;
    }
    items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'recent-search-chip';
      button.type = 'button';
      button.textContent = item.query + ' · ' + (item.source === 'audius' ? 'Audius' : 'YouTube');
      button.addEventListener('click', () => {
        const input = $('searchInput');
        input.value = item.query;
        const provider = $('searchSourceSelect');
        provider.value = item.source || 'youtube';
        provider.dispatchEvent(new Event('change'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      box.append(button);
    });
  }

  function renderTimeline(list) {
    const box = $('listeningTimeline');
    if (!box) return;
    box.replaceChildren();
    const cutoff = Date.now() - 30 * 86400000;
    const recent = (list || history()).filter(t => (t.playedAt || 0) >= cutoff).slice(0,30);
    if (!recent.length) {
      const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Your last 30 days of listening will appear here.';
      box.append(note); return;
    }
    const groups = new Map();
    recent.forEach(track => {
      const date = new Date(track.playedAt || Date.now());
      const key = date.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(track);
    });
    groups.forEach((tracks, date) => {
      const section = document.createElement('section'); section.className = 'timeline-day';
      const head = document.createElement('div'); head.className = 'row-between';
      const heading = document.createElement('strong'); heading.textContent = date;
      const count = document.createElement('span'); count.className = 'hint'; count.textContent = tracks.length + ' plays';
      head.append(heading,count); section.append(head);
      tracks.slice(0,6).forEach(track => {
        const line = document.createElement('div'); line.className = 'timeline-track';
        const title = document.createElement('span'); title.textContent = track.title || 'Unknown track';
        const artist = document.createElement('small'); artist.textContent = track.artist || '';
        line.append(title,artist); section.append(line);
      });
      box.append(section);
    });
  }

  function createSmartPlaylist() {
    const seed = history()[0] || Store.getLibrary()[0];
    if (!seed) { alert('Play or save a few songs first.'); return; }
    const unique = new Map();
    [...Store.getLibrary(), ...history()].forEach(track => { if (track && track.id && !unique.has(track.id)) unique.set(track.id, track); });
    const ranked = [...unique.values()].map(track => ({
      track,
      score: (track.artist && seed.artist && track.artist.toLowerCase() === seed.artist.toLowerCase() ? 3 : 0) +
        (track.title && seed.title && track.title.toLowerCase().split(/\\s+/).some(word => word.length > 4 && seed.title.toLowerCase().includes(word)) ? 1 : 0)
    })).sort((a,b) => b.score - a.score);
    const chosen = ranked.slice(0,20).map(x => x.track);
    const playlist = Store.createPlaylist('Made for you · ' + new Date().toLocaleDateString());
    chosen.forEach(track => Store.addToPlaylist(playlist.id, track));
    alert('Created "' + playlist.name + '" with ' + chosen.length + ' tracks from your existing library and history.');
  }

  function buildSmartQueue() {
    const seed = history()[0] || Store.getLibrary()[0];
    if (!seed) { alert('Play or save a few songs first.'); return; }
    const pool = [...Store.getLibrary(), ...history()].filter(t => t.id !== seed.id);
    const seen = new Set();
    const candidates = pool.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    candidates.sort((a,b) => Number((b.artist||'').toLowerCase() === (seed.artist||'').toLowerCase()) - Number((a.artist||'').toLowerCase() === (seed.artist||'').toLowerCase()));
    candidates.slice(0,10).forEach(track => window.dispatchEvent(new CustomEvent('deepflow:queue-track', { detail: track })));
    alert(`Added ${Math.min(10,candidates.length)} locally matched tracks. No YouTube searches were made.`);
  }

  function wrapped() {
    const now = new Date();
    const period = $('wrappedPeriodSelect').value;
    const year = now.getFullYear();
    const list = history().filter(track => {
      const date = new Date(track.playedAt || 0);
      return period === 'month'
        ? date.getFullYear() === year && date.getMonth() === now.getMonth()
        : date.getFullYear() === year;
    });
    const counts = new Map();
    const artists = new Map();
    const months = new Map();
    list.forEach(track => {
      const key = track.id || track.title;
      const entry = counts.get(key) || { track, count: 0 };
      entry.count++;
      counts.set(key, entry);
      if (track.artist) artists.set(track.artist, (artists.get(track.artist) || 0) + 1);
      const month = new Date(track.playedAt || 0).toLocaleDateString(undefined, { month:'long' });
      months.set(month, (months.get(month) || 0) + 1);
    });
    const ranked = [...counts.values()].sort((a,b) => b.count-a.count);
    const topArtist = [...artists.entries()].sort((a,b) => b[1]-a[1])[0];
    const busiest = [...months.entries()].sort((a,b) => b[1]-a[1])[0];
    const panel = $('wrappedPanel'); panel.classList.remove('hidden'); panel.replaceChildren();
    const periodName = period === 'month' ? now.toLocaleDateString(undefined, { month:'long', year:'numeric' }) : String(year);
    const h = document.createElement('h3'); h.textContent = periodName + ' · Your Resona Wrapped';
    const grid = document.createElement('div'); grid.className = 'wrapped-stats';
    const cards = [
      ['PLAY STARTS', String(list.length)],
      ['UNIQUE TRACKS', String(counts.size)],
      ['TOP TRACK', ranked[0] ? ranked[0].track.title : 'Not yet'],
      ['TOP ARTIST', topArtist ? topArtist[0] : 'Not yet'],
      ['BUSIEST MONTH', busiest ? busiest[0] : 'Not yet']
    ];
    cards.forEach(item => {
      const card = document.createElement('div'); card.className = 'wrapped-stat';
      const label = document.createElement('span'); label.textContent = item[0];
      const value = document.createElement('strong'); value.textContent = item[1];
      card.append(label,value); grid.append(card);
    });
    const note = document.createElement('p'); note.className = 'hint';
    note.textContent = 'Based on play starts recorded in this browser for the selected period. It does not estimate listening duration.';
    panel.append(h,grid,note);
  }
  function setAccent(hex) {
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    const n = parseInt(hex.slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    Store.saveSettings({ customAccent: hex });
  }
  function clearSleepTimer() {
    clearTimeout(sleepTimeout);
    clearInterval(sleepInterval);
    sleepTimeout = null;
    sleepInterval = null;
    sleepDeadline = 0;
    sleepAtTrackEnd = false;
    if ($('sleepTimerBtn')) $('sleepTimerBtn').textContent = 'Sleep';
  }
  function startSleepTimer() {
    const raw = prompt('Sleep timer: enter 5–240 minutes, "end" for the end of this song, or "off" to cancel.');
    if (raw === null) return;
    const value = raw.trim().toLowerCase();
    if (value === 'off' || value === 'cancel') {
      clearSleepTimer();
      return;
    }
    clearSleepTimer();
    if (value === 'end') {
      sleepAtTrackEnd = true;
      $('sleepTimerBtn').textContent = 'End of song';
      return;
    }
    const mins = Number(value);
    if (!Number.isFinite(mins) || mins < 5 || mins > 240) {
      alert('Enter a number between 5 and 240, "end", or "off".');
      return;
    }
    sleepDeadline = Date.now() + mins * 60000;
    const updateLabel = () => {
      const seconds = Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 1000));
      $('sleepTimerBtn').textContent = 'Sleep · ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    updateLabel();
    sleepInterval = setInterval(updateLabel, 1000);
    sleepTimeout = setTimeout(() => window.dispatchEvent(new Event('deepflow:sleep-stop')), mins * 60000);
  }
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.view === 'insights') renderInsights(); }));
  $('smartQueueBtn').addEventListener('click', buildSmartQueue);
  $('createSmartPlaylistBtn').addEventListener('click', createSmartPlaylist);
  $('wrappedBtn').addEventListener('click', wrapped);
  $('saveGoalBtn').addEventListener('click', () => {
    const goal = Math.max(1, Math.min(500, Math.floor(Number($('weeklyGoalInput').value) || 30)));
    Store.saveSettings({ weeklyPlayGoal: goal });
    renderWeeklyGoal();
  });
  $('moodQueueBtn').addEventListener('click', buildMoodQueue);
  $('clearSearchHistoryBtn').addEventListener('click', () => {
    Store.clearRecentSearches();
    renderRecentSearches();
  });
  window.addEventListener('resona:search-history-changed', renderRecentSearches);
  $('sleepTimerBtn').addEventListener('click', startSleepTimer);
  const goalNotificationToggle = $('weeklyGoalNotificationsToggle');
  if (goalNotificationToggle) {
    goalNotificationToggle.checked = !!Store.getSettings().weeklyGoalNotifications;
    goalNotificationToggle.addEventListener('change', async () => {
      if (goalNotificationToggle.checked) {
        if (!('Notification' in window)) {
          goalNotificationToggle.checked = false;
          alert('This browser does not support desktop notifications.');
          return;
        }
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission !== 'granted') {
          goalNotificationToggle.checked = false;
          alert('Notifications were not permitted. You can enable them in your browser site settings.');
          return;
        }
      }
      Store.saveSettings({ weeklyGoalNotifications: goalNotificationToggle.checked });
    });
  }
  function checkWeeklyGoalNotification() {
    const settings = Store.getSettings();
    if (!settings.weeklyGoalNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const start = new Date();
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const weekKey = start.getFullYear() + '-' + String(start.getMonth()+1).padStart(2,'0') + '-' + String(start.getDate()).padStart(2,'0');
    if (settings.lastWeeklyGoalNotification === weekKey) return;
    const goal = Math.max(1, Math.min(500, Number(settings.weeklyPlayGoal) || 30));
    const plays = history().filter(track => (track.playedAt || 0) >= start.getTime()).length;
    if (plays < goal) return;
    Store.saveSettings({ lastWeeklyGoalNotification: weekKey });
    try {
      const notice = new Notification('Weekly listening goal reached!', {
        body: 'You reached ' + goal + ' play starts this week. Nice work.',
        tag: 'resona-weekly-goal',
        renotify: false
      });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch (error) { console.warn('Weekly goal notification unavailable:', error); }
  }
  window.addEventListener('resona:track-changed', checkWeeklyGoalNotification);

  const notificationToggle = $('desktopNotificationsToggle');
  if (notificationToggle) {
    notificationToggle.checked = !!Store.getSettings().desktopNotifications;
    notificationToggle.addEventListener('change', async () => {
      if (notificationToggle.checked) {
        if (!('Notification' in window)) {
          notificationToggle.checked = false;
          alert('This browser does not support desktop notifications.');
          return;
        }
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission !== 'granted') {
          notificationToggle.checked = false;
          alert('Notifications were not permitted. You can enable them in your browser site settings.');
          return;
        }
      }
      Store.saveSettings({ desktopNotifications: notificationToggle.checked });
    });
  }
  window.addEventListener('resona:track-changed', event => {
    const track = event.detail?.track;
    if (!track || !Store.getSettings().desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const notice = new Notification(track.title || 'Now playing', {
        body: track.artist || 'Resona',
        icon: track.thumbnail || undefined,
        tag: 'resona-now-playing',
        renotify: false
      });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch (error) { console.warn('Desktop notification unavailable:', error); }
  });

  $('customAccent').addEventListener('input', e => setAccent(e.target.value));
  $('glassIntensity').addEventListener('input', e => document.documentElement.style.setProperty('--glass-blur', `${Number(e.target.value)}px`));
  window.addEventListener('deepflow:sleep-ended', clearSleepTimer);
  window.addEventListener('resona:track-ended', event => { if (sleepAtTrackEnd) { sleepAtTrackEnd = false; event.preventDefault(); window.dispatchEvent(new Event('deepflow:sleep-stop')); } });
  window.addEventListener('deepflow:sleep-stop', clearSleepTimer);
  const saved = Store.getSettings().customAccent; if (saved) { $('customAccent').value = saved; setAccent(saved); }
  const intensity = Store.getSettings().glassIntensity || 12; $('glassIntensity').value = intensity;
})();
