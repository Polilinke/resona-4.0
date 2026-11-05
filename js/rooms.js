// Supabase-backed, host-moderated Listening Rooms.
(() => {
  const $ = id => document.getElementById(id);
  const view = $('view-rooms');
  if (!view) return;

  let client = null;
  let user = null;
  let activeRoom = null;
  let channel = null;
  let lastTrackKey = '';
  let audioEnabled = false;
  let refreshing = false;
  let queueRows = [];

  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function setStatus(message, kind = 'info') {
    const el = $('roomsStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.kind = kind;
    el.classList.toggle('hidden', !message);
  }
  function hostMode() {
    return !!user && !!activeRoom && activeRoom.host_id === user.id;
  }
  function displayName() {
    return user?.user_metadata?.display_name?.trim() || user?.email?.split('@')[0] || 'Listener';
  }
  async function getClient() {
    if (client) return client;
    if (!window.ResonaAccount?.getClient) throw new Error('The account service is still loading. Refresh and try again.');
    client = await window.ResonaAccount.getClient();
    user = window.ResonaAccount.getUser();
    return client;
  }
  function showSignedOut() {
    $('roomsSignedOut').classList.remove('hidden');
    $('roomsLobby').classList.add('hidden');
    $('roomWorkspace').classList.add('hidden');
  }
  function showLobby() {
    $('roomsSignedOut').classList.add('hidden');
    $('roomsLobby').classList.remove('hidden');
    $('roomWorkspace').classList.add('hidden');
  }
  function showWorkspace() {
    $('roomsSignedOut').classList.add('hidden');
    $('roomsLobby').classList.add('hidden');
    $('roomWorkspace').classList.remove('hidden');
  }
  async function requireUser() {
    await getClient();
    user = window.ResonaAccount.getUser();
    if (!user) {
      showSignedOut();
      setStatus('Sign in to create or join a listening room.', 'error');
      return false;
    }
    return true;
  }
  function safeTrack(track) {
    const source = track?.source || 'youtube';
    if (!track || !track.title || !track.id || !['youtube','audius','archive','jamendo'].includes(source)) {
      throw new Error('This track cannot be shared in a room. Local files stay on the device that imported them.');
    }
    const clean = {
      id: String(track.id).slice(0, 180),
      title: String(track.title).slice(0, 220),
      artist: String(track.artist || 'Unknown artist').slice(0, 180),
      thumbnail: String(track.thumbnail || '').slice(0, 1000),
      source
    };
    ['audiusId','archiveId','streamUrl','permalink','licenseName','genre'].forEach(key => {
      if (track[key]) clean[key] = String(track[key]).slice(0, 1200);
    });
    if (track.duration) clean.duration = Number(track.duration) || 0;
    if (track.isDownloadable !== undefined) clean.isDownloadable = !!track.isDownloadable;
    return clean;
  }
  function trackKey(track) {
    return track ? String(track.source || 'youtube') + ':' + String(track.id || '') : '';
  }
  function trackCard(track, note = '') {
    const art = track.thumbnail
      ? '<img src="' + escapeText(track.thumbnail) + '" alt="" loading="lazy">'
      : '<div class="room-track-placeholder">♫</div>';
    return '<div class="room-track-card">' + art +
      '<div class="room-track-copy"><strong>' + escapeText(track.title || 'Untitled') +
      '</strong><span>' + escapeText(track.artist || 'Unknown artist') + '</span>' +
      (note ? '<small>' + escapeText(note) + '</small>' : '') + '</div></div>';
  }
  function makeButton(label, className, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'btn';
    button.textContent = label;
    button.disabled = !!disabled;
    button.addEventListener('click', action);
    return button;
  }
  async function loadMyRooms() {
    if (!await requireUser()) return;
    const list = $('myRoomsList');
    list.innerHTML = '<p class="rooms-muted">Loading your rooms…</p>';
    const { data: memberships, error: memberError } = await client
      .from('listening_room_members').select('room_id').eq('user_id', user.id);
    if (memberError) throw memberError;
    if (!memberships?.length) {
      list.innerHTML = '<div class="rooms-empty">No rooms yet. Create one or join with an invite code.</div>';
      return;
    }
    const ids = memberships.map(row => row.room_id);
    const { data: rooms, error } = await client.from('listening_rooms')
      .select('id,name,invite_code,host_id,status,created_at').in('id', ids).order('created_at', { ascending: false });
    if (error) throw error;
    list.replaceChildren();
    (rooms || []).forEach(room => {
      const card = document.createElement('div');
      card.className = 'room-list-card';
      const info = document.createElement('div');
      info.innerHTML = '<strong>' + escapeText(room.name) + '</strong><span>' +
        (room.status === 'active' ? 'Active · ' + (room.host_id === user.id ? 'Host' : 'Member') : 'Closed') +
        ' · Code ' + escapeText(room.invite_code) + '</span>';
      card.append(info, makeButton(room.status === 'active' ? 'Open room' : 'View', 'btn small', () => openRoom(room.id)));
      list.append(card);
    });
  }
  async function createRoom() {
    try {
      if (!await requireUser()) return;
      const name = $('newRoomName').value.trim();
      if (name.length < 2 || name.length > 48) throw new Error('Room name must be 2–48 characters.');
      const { data, error } = await client.rpc('create_listening_room', { p_name: name });
      if (error) throw error;
      $('newRoomName').value = '';
      await openRoom(data.id);
      setStatus('Room created. Share the invite code with your friends.', 'success');
    } catch (error) { setStatus(error.message || 'Could not create the room.', 'error'); }
  }
  async function joinRoom() {
    try {
      if (!await requireUser()) return;
      const code = $('joinRoomCode').value.trim().toUpperCase();
      if (!/^[A-F0-9]{8}$/.test(code)) throw new Error('Enter the 8-character room invite code.');
      const { data, error } = await client.rpc('join_listening_room', { p_invite_code: code });
      if (error) throw error;
      $('joinRoomCode').value = '';
      await openRoom(data.id);
      setStatus('You joined ' + data.name + '.', 'success');
    } catch (error) { setStatus(error.message || 'Could not join the room.', 'error'); }
  }
  async function openRoom(roomId) {
    try {
      if (!await requireUser()) return;
      if (channel) { await client.removeChannel(channel); channel = null; }
      const { data: room, error } = await client.from('listening_rooms')
        .select('*').eq('id', roomId).single();
      if (error) throw error;
      activeRoom = room;
      lastTrackKey = '';
      showWorkspace();
      renderRoom();
      await refreshRoom();
      subscribeRoom();
    } catch (error) {
      setStatus(error.message || 'Could not open this room. Check that the Listening Rooms SQL setup has been run in Supabase.', 'error');
    }
  }
  function renderRoom() {
    if (!activeRoom) return;
    $('roomName').textContent = activeRoom.name;
    $('roomInviteCode').textContent = activeRoom.invite_code;
    $('roomHostLabel').textContent = hostMode() ? 'You are the host' : 'Host-moderated room';
    $('roomHostControls').classList.toggle('hidden', !hostMode());
    $('roomSuggestHint').textContent = 'Suggest tracks from search results. The host must approve them before they enter the shared queue.';
    $('roomPlaybackLabel').textContent = activeRoom.current_track
      ? activeRoom.current_track.title + ' · ' + (activeRoom.playback_state === 'playing' ? 'Playing' : 'Paused')
      : 'Nothing playing yet';
    $('roomPlayPauseBtn').textContent = activeRoom.playback_state === 'playing' ? 'Pause for everyone' : 'Play for everyone';
    $('roomPlayPauseBtn').disabled = !activeRoom.current_track || activeRoom.status !== 'active';
    $('roomNextBtn').disabled = !hostMode() || activeRoom.status !== 'active' || !queueRows.length;
    const duration = Number(activeRoom.current_track?.duration) || 600;
    $('roomSeek').max = String(Math.max(60, Math.ceil(duration)));
    $('roomSeek').value = String(Math.min(Number(activeRoom.playback_position) || 0, Math.max(60, Math.ceil(duration))));
    $('roomAudioEnableBtn').textContent = audioEnabled ? 'Room audio enabled' : 'Enable room audio';
    $('roomAudioEnableBtn').disabled = audioEnabled;
    if (activeRoom.status === 'closed') {
      $('roomClosedNotice').classList.remove('hidden');
      $('roomHostControls').classList.add('hidden');
      $('roomSuggestBtn')?.setAttribute('disabled', 'disabled');
    } else {
      $('roomClosedNotice').classList.add('hidden');
      $('roomSuggestBtn')?.removeAttribute('disabled');
    }
  }
  async function refreshRoom() {
    if (!activeRoom || refreshing) return;
    refreshing = true;
    try {
      const id = activeRoom.id;
      const [roomResult, memberResult, suggestionResult, queueResult] = await Promise.all([
        client.from('listening_rooms').select('*').eq('id', id).single(),
        client.from('listening_room_members').select('user_id,display_name,joined_at').eq('room_id', id).order('joined_at'),
        client.from('listening_room_suggestions').select('*').eq('room_id', id).order('created_at', { ascending: false }),
        client.from('listening_room_queue').select('*').eq('room_id', id).order('position')
      ]);
      for (const result of [roomResult, memberResult, suggestionResult, queueResult]) if (result.error) throw result.error;
      activeRoom = roomResult.data;
      renderRoom();
      renderMembers(memberResult.data || []);
      renderSuggestions(suggestionResult.data || []);
      renderQueue(queueResult.data || []);
      await syncRoomPlayback(activeRoom);
    } catch (error) {
      setStatus(error.message || 'Room update failed.', 'error');
    } finally { refreshing = false; }
  }
  function renderMembers(members) {
    const box = $('roomMembers');
    box.replaceChildren();
    $('roomMemberCount').textContent = String(members.length);
    members.forEach(member => {
      const chip = document.createElement('div');
      chip.className = 'room-member-chip';
      const avatar = document.createElement('span');
      avatar.className = 'room-member-avatar';
      avatar.textContent = (member.display_name || 'L').charAt(0).toUpperCase();
      const name = document.createElement('span');
      name.textContent = member.display_name + (member.user_id === activeRoom.host_id ? ' · Host' : '');
      chip.append(avatar, name);
      box.append(chip);
    });
  }
  function renderSuggestions(rows) {
    const box = $('roomSuggestions');
    box.replaceChildren();
    const pending = rows.filter(row => row.status === 'pending');
    $('roomPendingCount').textContent = String(pending.length);
    if (!rows.length) box.innerHTML = '<div class="rooms-empty">No suggestions yet. Search for a track and suggest it to the room.</div>';
    rows.forEach(row => {
      const item = document.createElement('article');
      item.className = 'room-suggestion';
      const details = document.createElement('div');
      details.innerHTML = trackCard(row.track, 'Suggested by ' + (row.user_id === user.id ? 'you' : 'a room member'));
      const status = document.createElement('span');
      status.className = 'room-state-pill ' + row.status;
      status.textContent = row.status === 'pending' ? 'Awaiting approval' : row.status;
      item.append(details, status);
      if (hostMode() && row.status === 'pending' && activeRoom.status === 'active') {
        const actions = document.createElement('div');
        actions.className = 'room-review-actions';
        actions.append(
          makeButton('Approve', 'btn small primary', () => reviewSuggestion(row.id, true)),
          makeButton('Reject', 'btn small ghost', () => reviewSuggestion(row.id, false))
        );
        item.append(actions);
      }
      box.append(item);
    });
  }
  function renderQueue(rows) {
    queueRows = rows || [];
    const box = $('roomQueue');
    box.replaceChildren();
    if (!rows.length) box.innerHTML = '<div class="rooms-empty">Approved tracks will appear here.</div>';
    rows.forEach((row, index) => {
      const item = document.createElement('article');
      item.className = 'room-queue-item';
      const details = document.createElement('div');
      details.innerHTML = trackCard(row.track, 'Queue position ' + (index + 1));
      item.append(details);
      if (hostMode() && activeRoom.status === 'active') {
        item.append(makeButton('Play for everyone', 'btn small primary', () => playQueueItem(row.id)));
      }
      box.append(item);
    });
  }
  function subscribeRoom() {
    if (!activeRoom) return;
    const id = activeRoom.id;
    channel = client.channel('listening-room-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_rooms', filter: 'id=eq.' + id }, payload => {
        if (payload.new) {
          activeRoom = { ...activeRoom, ...payload.new };
          renderRoom();
          syncRoomPlayback(activeRoom);
        }
        refreshRoom();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_room_members', filter: 'room_id=eq.' + id }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_room_suggestions', filter: 'room_id=eq.' + id }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_room_queue', filter: 'room_id=eq.' + id }, refreshRoom)
      .subscribe();
  }
  async function reviewSuggestion(id, approve) {
    try {
      const { error } = await client.rpc('review_listening_room_suggestion', {
        p_suggestion_id: id, p_approve: approve
      });
      if (error) throw error;
      setStatus(approve ? 'Suggestion approved and added to the shared queue.' : 'Suggestion rejected.', 'success');
      await refreshRoom();
    } catch (error) { setStatus(error.message || 'Could not review suggestion.', 'error'); }
  }
  async function playQueueItem(id) {
    try {
      const { error } = await client.rpc('play_listening_room_queue_item', {
        p_room_id: activeRoom.id, p_queue_item_id: id
      });
      if (error) throw error;
      setStatus('Now playing for the room.', 'success');
      await refreshRoom();
    } catch (error) { setStatus(error.message || 'Could not start room playback.', 'error'); }
  }
  async function nextRoomTrack() {
    if (!hostMode() || !queueRows.length) return;
    const currentIndex = queueRows.findIndex(row => row.id === activeRoom.current_queue_item_id);
    const next = queueRows[currentIndex + 1] || queueRows.find(row => row.id !== activeRoom.current_queue_item_id);
    if (!next) {
      setStatus('There are no other approved tracks in the shared queue.', 'info');
      return;
    }
    await playQueueItem(next.id);
  }
  async function setRoomPlayback(playing, position) {
    if (!hostMode() || !activeRoom?.current_track) return;
    try {
      const { error } = await client.rpc('control_listening_room_playback', {
        p_room_id: activeRoom.id,
        p_state: playing ? 'playing' : 'paused',
        p_position: Math.max(0, Number(position) || 0)
      });
      if (error) throw error;
    } catch (error) { setStatus(error.message || 'Could not update room playback.', 'error'); }
  }
  async function syncRoomPlayback(room) {
    if (!room?.current_track || !window.ResonaPlayback) return;
    const key = trackKey(room.current_track);
    const position = Number(room.playback_position) || 0;
    const elapsed = room.playback_state === 'playing'
      ? Math.max(0, (Date.now() - new Date(room.playback_updated_at).getTime()) / 1000) : 0;
    const target = position + elapsed;
    const duration = Number(room.current_track.duration) || 600;
    $('roomSeek').max = String(Math.max(60, Math.ceil(duration)));
    $('roomSeek').value = String(Math.min(target, Math.max(60, Math.ceil(duration))));
    if (!audioEnabled) {
      $('roomPlaybackLabel').textContent = room.current_track.title + ' · ' +
        (room.playback_state === 'playing' ? 'Playing in room — enable audio to hear it' : 'Paused');
      return;
    }
    if (key !== lastTrackKey) {
      lastTrackKey = key;
      window.ResonaPlayback.play(room.current_track, target, room.playback_state === 'playing');
    } else {
      window.ResonaPlayback.setState(room.playback_state === 'playing', target);
    }
  }
  async function enableRoomAudio() {
    if (!activeRoom?.current_track) {
      audioEnabled = true;
      $('roomAudioEnableBtn').textContent = 'Room audio enabled';
      $('roomAudioEnableBtn').disabled = true;
      setStatus('Room audio is enabled. Playback will start when the host chooses a track.', 'success');
      return;
    }
    audioEnabled = true;
    $('roomAudioEnableBtn').textContent = 'Room audio enabled';
    $('roomAudioEnableBtn').disabled = true;
    await syncRoomPlayback(activeRoom);
    setStatus('Room playback enabled on this device.', 'success');
  }
  async function leaveRoom() {
    if (!activeRoom) return;
    if (channel) { await client.removeChannel(channel); channel = null; }
    try {
      const { error } = await client.rpc('leave_listening_room', { p_room_id: activeRoom.id });
      if (error) throw error;
      activeRoom = null; lastTrackKey = ''; audioEnabled = false;
      showLobby(); await loadMyRooms();
      setStatus('You left the room.', 'success');
    } catch (error) { setStatus(error.message || 'Could not leave the room.', 'error'); }
  }
  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(activeRoom.invite_code);
      setStatus('Invite code copied.', 'success');
    } catch { setStatus('Invite code: ' + activeRoom.invite_code, 'info'); }
  }
  async function open() {
    try {
      if (!await requireUser()) return;
      setStatus('');
      showLobby();
      await loadMyRooms();
    } catch (error) {
      showLobby();
      setStatus(error.message || 'Could not load Listening Rooms. Run the SQL setup in Supabase first.', 'error');
    }
  }
  async function suggestTrack(track) {
    if (!activeRoom || activeRoom.status !== 'active') {
      setStatus('Open an active Listening Room first.', 'error');
      return false;
    }
    try {
      const clean = safeTrack(track);
      const { error } = await client.rpc('submit_listening_room_suggestion', {
        p_room_id: activeRoom.id, p_track: clean
      });
      if (error) throw error;
      setStatus('Track sent to the host for approval.', 'success');
      await refreshRoom();
      return true;
    } catch (error) {
      setStatus(error.message || 'Could not suggest this track.', 'error');
      return false;
    }
  }

  $('createRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', joinRoom);
  $('refreshRoomsBtn').addEventListener('click', () => loadMyRooms().catch(error => setStatus(error.message, 'error')));
  $('roomLeaveBtn').addEventListener('click', leaveRoom);
  $('roomCopyCodeBtn').addEventListener('click', copyInviteCode);
  $('roomAudioEnableBtn').addEventListener('click', enableRoomAudio);
  $('roomNextBtn').addEventListener('click', nextRoomTrack);
  $('roomPlayPauseBtn').addEventListener('click', async () => {
    if (!hostMode()) return;
    const playing = activeRoom.playback_state !== 'playing';
    const position = window.ResonaPlayback?.getPosition?.() ?? activeRoom.playback_position;
    await setRoomPlayback(playing, position);
  });
  $('roomSeek').addEventListener('change', async event => {
    if (!hostMode()) return;
    await setRoomPlayback(activeRoom.playback_state === 'playing', Number(event.target.value));
  });
  $('roomBackToLobbyBtn').addEventListener('click', async () => {
    if (channel) { await client.removeChannel(channel); channel = null; }
    activeRoom = null; lastTrackKey = ''; audioEnabled = false;
    showLobby(); await loadMyRooms().catch(error => setStatus(error.message, 'error'));
  });

  window.ResonaRooms = {
    open,
    isActive: () => !!activeRoom && activeRoom.status === 'active',
    suggestTrack
  };
  window.addEventListener('resona:auth-ready', event => {
    user = event.detail?.user || null;
    if (document.getElementById('view-rooms')?.classList.contains('active')) open();
  });
  window.addEventListener('resona:auth-changed', event => {
    const next = event.detail?.user || null;
    if (user?.id !== next?.id) {
      user = next;
      activeRoom = null; lastTrackKey = ''; audioEnabled = false;
      if (channel && client) client.removeChannel(channel).catch(() => {});
      channel = null;
      if (document.getElementById('view-rooms')?.classList.contains('active')) open();
    }
  });
  if (window.ResonaAccount?.getClient) {
    window.ResonaAccount.getClient().then(() => {
      user = window.ResonaAccount.getUser();
      if (document.getElementById('view-rooms')?.classList.contains('active')) open();
    }).catch(() => {});
  }
})();
