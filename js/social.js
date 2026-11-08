// Resona Social: friends-only DMs, room chat and invitations.
(() => {
  const $ = id => document.getElementById(id);
  const socialView = $('view-social');
  if (!socialView) return;
  let client = null, user = null, activeFriend = null, dmChannel = null, roomChannel = null, activeRoom = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nameOf = profile => profile?.display_name || 'Listener';
  function status(message, kind='info') {
    const el=$('socialStatus'); if(!el) return;
    el.textContent=message||''; el.dataset.kind=kind; el.classList.toggle('hidden',!message);
  }
  async function connect() {
    if(client) return client;
    if(!window.ResonaAccount?.getClient) throw new Error('Account service is still loading. Refresh and try again.');
    client=await window.ResonaAccount.getClient(); user=window.ResonaAccount.getUser();
    return client;
  }
  function signedInUI() {
    $('socialSignedOut')?.classList.toggle('hidden',!!user);
    $('socialWorkspace')?.classList.toggle('hidden',!user);
  }
  function button(label, cls, fn) {
    const b=document.createElement('button'); b.type='button'; b.className=cls||'btn small'; b.textContent=label; b.addEventListener('click',fn); return b;
  }
  function row(profile, subtitle='') {
    const el=document.createElement('div'); el.className='social-person-row';
    const avatar=document.createElement('span'); avatar.className='room-member-avatar'; avatar.textContent=nameOf(profile).slice(0,1).toUpperCase();
    const copy=document.createElement('div'); copy.className='social-person-copy';
    const strong=document.createElement('strong'); strong.textContent=nameOf(profile);
    const small=document.createElement('small'); small.textContent=subtitle||profile.bio||'Resona listener';
    copy.append(strong,small); el.append(avatar,copy); return el;
  }
  async function profilesByIds(ids) {
    if(!ids.length) return [];
    const {data,error}=await client.from('resona_profiles').select('user_id,display_name,bio').in('user_id',ids);
    if(error) throw error; return data||[];
  }

  async function loadFriendActivity(friendIds) {
    const box = $('socialActivityList');
    if (!box) return;
    box.replaceChildren();
    if (!friendIds.length) {
      box.innerHTML = '<div class="rooms-empty">Add friends to see shared listening activity.</div>';
      return;
    }
    try {
      const { data, error } = await client.from('resona_friend_activity')
        .select('user_id,track,updated_at').in('user_id', friendIds).eq('sharing_enabled', true)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) {
        box.innerHTML = '<div class="rooms-empty">No friends are sharing activity right now. Activity sharing is optional.</div>';
        return;
      }
      const profiles = await profilesByIds(rows.map(x => x.user_id));
      const names = new Map(profiles.map(p => [p.user_id, nameOf(p)]));
      rows.forEach(item => {
        const track = item.track || {};
        const card = document.createElement('div');
        card.className = 'social-activity-card';
        const title = document.createElement('strong');
        title.textContent = names.get(item.user_id) || 'Friend';
        const song = document.createElement('span');
        song.textContent = track.title ? 'Listening to ' + track.title + (track.artist ? ' · ' + track.artist : '') : 'Recently active';
        const when = document.createElement('small');
        when.textContent = 'Updated ' + new Date(item.updated_at).toLocaleString();
        card.append(title, song, when);
        box.append(card);
      });
    } catch (error) {
      box.innerHTML = '<div class="rooms-empty">Friend activity needs the Stage 3 Supabase migration. Apply supabase/stage-3-social-upgrades.sql to enable it.</div>';
    }
  }

  async function setActivitySharing(enabled) {
    try {
      await connect();
      if (!user) throw new Error('Sign in to change activity sharing.');
      const { error } = await client.from('resona_friend_activity').upsert({
        user_id: user.id, sharing_enabled: !!enabled, track: null, updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) throw error;
      status(enabled ? 'Friend activity sharing is on. Friends can see your current track.' : 'Friend activity sharing is off.', 'success');
      const friendships = await client.from('resona_friendships').select('requester_id,addressee_id')
        .or('requester_id.eq.' + user.id + ',addressee_id.eq.' + user.id).eq('status','accepted');
      if (!friendships.error) {
        const ids = (friendships.data || []).map(x => x.requester_id === user.id ? x.addressee_id : x.requester_id);
        await loadFriendActivity(ids);
      }
    } catch (error) {
      $('activitySharingToggle').checked = false;
      status(error.message || 'Could not update activity sharing. Apply the Stage 3 Supabase migration first.', 'error');
    }
  }

  async function publishCurrentTrack(track) {
    if (!client || !user || !$('activitySharingToggle')?.checked || !track?.id) return;
    const safeTrack = {
      id: String(track.id).slice(0, 180),
      title: String(track.title || 'Unknown track').slice(0, 180),
      artist: String(track.artist || 'Unknown artist').slice(0, 140),
      source: String(track.source || 'youtube').slice(0, 24)
    };
    const { error } = await client.from('resona_friend_activity').upsert({
      user_id: user.id, sharing_enabled: true, track: safeTrack, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) status('Could not update friend activity. Check the Stage 3 Supabase migration.', 'error');
  }


  async function loadCollaborativePlaylists(friendIds = []) {
    const box = $('collabPlaylistsList');
    if (!box || !user) return;
    try {
      const { data: playlists, error } = await client.from('resona_collaborative_playlists')
        .select('id,name,owner_id,created_at').order('updated_at', { ascending: false });
      if (error) throw error;
      box.replaceChildren();
      if (!playlists?.length) {
        box.innerHTML = '<div class="rooms-empty">No shared playlists yet. Create one to get started.</div>';
        return;
      }
      const { data: friends, error: friendsError } = await client.from('resona_friendships')
        .select('requester_id,addressee_id').eq('status','accepted')
        .or('requester_id.eq.' + user.id + ',addressee_id.eq.' + user.id);
      if (friendsError) throw friendsError;
      const friendIdsList = [...new Set((friends || []).map(x => x.requester_id === user.id ? x.addressee_id : x.requester_id))];
      const friendProfiles = await profilesByIds(friendIdsList);
      const library = [...(window.Store?.getLibrary?.() || []), ...(window.Store?.getHistory?.() || [])];
      const uniqueTracks = [...new Map(library.filter(t => t?.id).map(t => [t.source + ':' + t.id, t])).values()];
      for (const playlist of playlists) {
        const card = document.createElement('article'); card.className = 'social-collab-card';
        const heading = document.createElement('strong'); heading.textContent = playlist.name;
        const owner = document.createElement('small'); owner.textContent = playlist.owner_id === user.id ? 'Created by you' : 'Shared with you';
        const controls = document.createElement('div'); controls.className = 'social-collab-controls';
        const inviteSelect = document.createElement('select');
        inviteSelect.setAttribute('aria-label','Choose a friend to invite');
        const inviteDefault = document.createElement('option'); inviteDefault.value=''; inviteDefault.textContent='Invite a friend…'; inviteSelect.append(inviteDefault);
        friendProfiles.forEach(p=>{const o=document.createElement('option');o.value=p.user_id;o.textContent=nameOf(p);inviteSelect.append(o);});
        const inviteBtn = button('Invite','btn small',async()=>{
          if(!inviteSelect.value){status('Choose a friend first.','error');return;}
          const {error}=await client.from('resona_collaborative_playlist_members').insert({playlist_id:playlist.id,user_id:inviteSelect.value,role:'editor'});
          if(error){status(error.message,'error');return;}
          status('Friend added to the collaborative playlist.','success');inviteSelect.value='';
        });
        const trackSelect = document.createElement('select');
        trackSelect.setAttribute('aria-label','Choose a saved or recently played track');
        const trackDefault=document.createElement('option');trackDefault.value='';trackDefault.textContent='Add a track from your library…';trackSelect.append(trackDefault);
        uniqueTracks.forEach((t,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(t.title||'Untitled')+' — '+(t.artist||'Unknown artist');trackSelect.append(o);});
        const addBtn=button('Add track','btn small primary',async()=>{
          if(trackSelect.value===''){status('Choose a track first.','error');return;}
          const track=uniqueTracks[Number(trackSelect.value)];
          const {error}=await client.from('resona_collaborative_playlist_tracks').insert({playlist_id:playlist.id,track,added_by:user.id,position:Date.now()});
          if(error){status(error.message,'error');return;}
          status('Track added to '+playlist.name+'.','success');await loadCollaborativePlaylists(friendIds);
        });
        controls.append(inviteSelect,inviteBtn,trackSelect,addBtn);
        const trackBox=document.createElement('div');trackBox.className='social-collab-tracks';
        const {data:tracks,error:trackError}=await client.from('resona_collaborative_playlist_tracks')
          .select('id,track,added_by').eq('playlist_id',playlist.id).order('position',{ascending:true}).order('added_at',{ascending:true});
        if(trackError) throw trackError;
        (tracks||[]).forEach(entry=>{
          const line=document.createElement('div');line.className='social-collab-track';
          const label=document.createElement('span');label.textContent=(entry.track?.title||'Unknown track')+' · '+(entry.track?.artist||'Unknown artist');
          const remove=button('Remove','btn small ghost',async()=>{
            const {error}=await client.from('resona_collaborative_playlist_tracks').delete().eq('id',entry.id);
            if(error){status(error.message,'error');return;}
            await loadCollaborativePlaylists(friendIds);
          });
          line.append(label,remove);trackBox.append(line);
        });
        if(!tracks?.length) trackBox.innerHTML='<div class="rooms-empty">No tracks yet. Add one from your library.</div>';
        card.append(heading,owner,controls,trackBox);box.append(card);
      }
    } catch (error) {
      box.innerHTML = '<div class="rooms-empty">Collaborative playlists need the Stage 3 Supabase migration. Apply supabase/stage-3-social-upgrades.sql, then refresh. ' + esc(error.message || '') + '</div>';
    }
  }

  async function createCollaborativePlaylist() {
    try {
      await connect();
      if (!user) throw new Error('Sign in to create a collaborative playlist.');
      const name = $('collabPlaylistName').value.trim();
      if (!name) throw new Error('Enter a playlist name.');
      const { error } = await client.from('resona_collaborative_playlists').insert({ owner_id:user.id, name });
      if (error) throw error;
      $('collabPlaylistName').value='';
      status('Collaborative playlist created. Invite friends to contribute.','success');
      const {data:friendships}=await client.from('resona_friendships').select('requester_id,addressee_id')
        .eq('status','accepted').or('requester_id.eq.'+user.id+',addressee_id.eq.'+user.id);
      const ids=(friendships||[]).map(x=>x.requester_id===user.id?x.addressee_id:x.requester_id);
      await loadCollaborativePlaylists(ids);
    } catch(error) { status(error.message || 'Could not create the collaborative playlist. Apply the Stage 3 migration first.','error'); }
  }

  async function loadSocial() {
    await connect(); user=window.ResonaAccount.getUser(); signedInUI();
    if(!user) return;
    const {data:friendships,error}=await client.from('resona_friendships').select('*')
      .or('requester_id.eq.'+user.id+',addressee_id.eq.'+user.id).order('created_at',{ascending:false});
    if(error) throw error;
    const rows=friendships||[];
    const friendIds=rows.filter(x=>x.status==='accepted').map(x=>x.requester_id===user.id?x.addressee_id:x.requester_id);
    const incoming=rows.filter(x=>x.status==='pending'&&x.addressee_id===user.id);
    const outgoing=rows.filter(x=>x.status==='pending'&&x.requester_id===user.id);
    const allIds=[...new Set([...friendIds,...incoming.map(x=>x.requester_id),...outgoing.map(x=>x.addressee_id)])];
    const people=await profilesByIds(allIds); const byId=new Map(people.map(p=>[p.user_id,p]));
    renderFriends(friendIds.map(id=>byId.get(id)).filter(Boolean));
    await loadFriendActivity(friendIds);
    await loadCollaborativePlaylists(friendIds);
    renderRequests(incoming,outgoing,byId);
    renderConversations(friendIds.map(id=>byId.get(id)).filter(Boolean));
    await loadInvites(byId);
  }
  function renderFriends(friends) {
    $('socialFriendCount').textContent=String(friends.length);
    const box=$('socialFriendsList'); box.replaceChildren();
    if(!friends.length){box.innerHTML='<div class="rooms-empty">No friends yet. Search for someone above.</div>';return;}
    friends.forEach(p=>{
      const el=row(p,p.bio||'Friend');
      el.append(button('Message','btn small primary',()=>openDM(p)));
      el.append(button('Remove','btn small ghost',()=>removeFriend(p)));
      el.append(button('Block','btn small ghost',()=>blockUser(p)));
      box.append(el);
    });
  }
  function renderRequests(incoming,outgoing,byId) {
    const box=$('socialRequestsList'); box.replaceChildren();
    if(!incoming.length&&!outgoing.length){box.innerHTML='<div class="rooms-empty">No pending requests.</div>';return;}
    incoming.forEach(req=>{
      const p=byId.get(req.requester_id); if(!p)return;
      const el=row(p,'Wants to be your friend');
      el.append(button('Accept','btn small primary',()=>respondRequest(req.id,true)));
      el.append(button('Decline','btn small ghost',()=>respondRequest(req.id,false)));
      box.append(el);
    });
    outgoing.forEach(req=>{const p=byId.get(req.addressee_id);if(p)box.append(row(p,'Request sent · waiting for response'));});
  }
  function renderConversations(friends) {
    const box=$('socialConversationsList'); box.replaceChildren();
    if(!friends.length){box.innerHTML='<div class="rooms-empty">Add a friend to start a private conversation.</div>';return;}
    friends.forEach(p=>{
      const b=button(nameOf(p),'social-conversation-button'+(activeFriend?.user_id===p.user_id?' active':''),()=>openDM(p));
      box.append(b);
    });
  }
  async function loadInvites(profileMap=new Map()) {
    const {data,error}=await client.from('resona_room_invites').select('*')
      .eq('invitee_id',user.id).eq('status','pending').order('created_at',{ascending:false});
    if(error) throw error;
    const ids=[...new Set((data||[]).map(x=>x.inviter_id))];
    const missing=ids.filter(id=>!profileMap.has(id));
    if(missing.length){const ps=await profilesByIds(missing);ps.forEach(p=>profileMap.set(p.user_id,p));}
    const box=$('socialInvitesList'); box.replaceChildren();
    if(!data?.length){box.innerHTML='<div class="rooms-empty">No room invitations.</div>';return;}
    data.forEach(inv=>{
      const p=profileMap.get(inv.inviter_id)||{display_name:'A friend'};
      const el=row(p,'Invited you to a private listening room');
      el.append(button('Join','btn small primary',()=>respondInvite(inv.id,true)));
      el.append(button('Decline','btn small ghost',()=>respondInvite(inv.id,false)));
      box.append(el);
    });
  }
  async function searchPeople() {
    try {
      await connect(); const q=$('socialSearchInput').value.trim();
      if(q.length<2) throw new Error('Enter at least two characters to search.');
      const {data,error}=await client.rpc('search_resona_people',{p_query:q}); if(error) throw error;
      const box=$('socialSearchResults'); box.replaceChildren();
      if(!data?.length){box.innerHTML='<div class="rooms-empty">No matching profiles found.</div>';return;}
      data.forEach(p=>{
        const el=row({display_name:p.display_name,bio:p.bio},p.friendship_status==='friends'?'Already friends':p.friendship_status==='pending'?(p.request_direction==='sent'?'Request sent':'Request received'):(p.bio||'Resona listener'));
        if(p.friendship_status==='none') el.append(button('Add friend','btn small primary',()=>sendRequest(p.user_id)));
        box.append(el);
      });
    } catch(e){status(e.message||'Could not search profiles.','error');}
  }
  async function sendRequest(id) {
    try{const {error}=await client.rpc('send_resona_friend_request',{p_user_id:id});if(error)throw error;status('Friend request sent.','success');await searchPeople();await loadSocial();}
    catch(e){status(e.message||'Could not send friend request.','error');}
  }
  async function respondRequest(id,accept) {
    try{const {error}=await client.rpc('respond_resona_friend_request',{p_request_id:id,p_accept:accept});if(error)throw error;status(accept?'Friend request accepted.':'Request declined.','success');await loadSocial();}
    catch(e){status(e.message||'Could not update request.','error');}
  }
  async function removeFriend(p) {
    if(!confirm('Remove '+nameOf(p)+' from your friends?'))return;
    try{const {error}=await client.rpc('remove_resona_friend',{p_user_id:p.user_id});if(error)throw error;activeFriend=null;await loadSocial();status('Friend removed.','success');}
    catch(e){status(e.message||'Could not remove friend.','error');}
  }
  async function blockUser(p) {
    if(!confirm('Block '+nameOf(p)+'? This also removes the friendship and prevents messaging.'))return;
    try{const {error}=await client.rpc('block_resona_user',{p_user_id:p.user_id});if(error)throw error;activeFriend=null;await loadSocial();status('Account blocked.','success');}
    catch(e){status(e.message||'Could not block account.','error');}
  }
  async function respondInvite(id,accept) {
    try{
      const {data,error}=await client.rpc('respond_resona_room_invite',{p_invite_id:id,p_accept:accept});if(error)throw error;
      if(accept&&data?.invite_code){$('joinRoomCode').value=data.invite_code;document.querySelector('[data-view="rooms"]')?.click();status('You joined '+(data.room_name||'the room')+'. Open Listening Rooms to enter.','success');}
      else {status('Invitation declined.','success');await loadInvites();}
    }catch(e){status(e.message||'Could not respond to invitation.','error');}
  }
  async function openDM(friend) {
    try{
      await connect();
      const {data:blocked,error:blockError}=await client.from('resona_blocks').select('blocker_id,blocked_id')
        .or('and(blocker_id.eq.'+user.id+',blocked_id.eq.'+friend.user_id+'),and(blocker_id.eq.'+friend.user_id+',blocked_id.eq.'+user.id+')');
      if(blockError)throw blockError;
      if(blocked?.length)throw new Error('Messaging is unavailable for this account.');
      activeFriend=friend;
      $('socialChatHeading').textContent=nameOf(friend);
      $('socialChatInput').disabled=false;
      $('socialChatForm').querySelector('button').disabled=false;
      const {data:friendships,error:friendshipsError}=await client.from('resona_friendships')
        .select('requester_id,addressee_id').eq('status','accepted')
        .or('requester_id.eq.'+user.id+',addressee_id.eq.'+user.id);
      if(friendshipsError)throw friendshipsError;
      const friendIds=(friendships||[]).map(x=>x.requester_id===user.id?x.addressee_id:x.requester_id).filter(Boolean);
      const conversationProfiles=await profilesByIds(friendIds);
      renderConversations(conversationProfiles);
      await loadDMs();
      if(dmChannel)await client.removeChannel(dmChannel);
      dmChannel=client.channel('resona-dm-'+[user.id,friend.user_id].sort().join('-'))
        .on('postgres_changes',{event:'*',schema:'public',table:'resona_direct_messages'},payload=>{
          const m=payload.new||payload.old;
          if(m&&(m.sender_id===user.id||m.recipient_id===user.id)&&
            (m.sender_id===friend.user_id||m.recipient_id===friend.user_id))loadDMs();
        }).subscribe();
    }catch(e){status(e.message||'Could not open conversation.','error');}
  }
  async function loadDMs() {
    if(!activeFriend)return;
    const a=user.id,b=activeFriend.user_id;
    const {data,error}=await client.from('resona_direct_messages').select('*')
      .or('and(sender_id.eq.'+a+',recipient_id.eq.'+b+'),and(sender_id.eq.'+b+',recipient_id.eq.'+a+')')
      .gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:true}).limit(100);
    if(error)throw error;
    renderMessages($('socialChatMessages'),data||[],false);
  }
  function renderMessages(box,rows,isRoom) {
    box.replaceChildren();
    if(!rows.length){box.innerHTML='<div class="rooms-empty">No messages yet. Say hello!</div>';return;}
    rows.forEach(m=>{
      const item=document.createElement('div');item.className='social-message'+(m.sender_id===user.id||m.user_id===user.id?' mine':'');
      const meta=document.createElement('div');meta.className='social-message-meta';
      meta.textContent=(isRoom?(m.display_name||'Listener')+' · ':'')+new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      const body=document.createElement('div');body.className='social-message-body';body.textContent=m.body;
      item.append(meta,body);
      if(isRoom&&(m.user_id===user.id||activeRoom?.host_id===user.id))item.append(button('Remove','btn tiny ghost',()=>deleteRoomMessage(m.id)));
      if(isRoom&&m.user_id!==user.id)item.append(button('Report','btn tiny ghost',()=>reportMessage('room',m.id)));
      if(!isRoom&&m.sender_id!==user.id)item.append(button('Report','btn tiny ghost',()=>reportMessage('direct',m.id)));
      box.append(item);
    });
    box.scrollTop=box.scrollHeight;
  }
  async function sendDM(event) {
    event.preventDefault(); if(!activeFriend)return;
    const body=$('socialChatInput').value.trim(); if(!body)return;
    const submit=$('socialChatForm').querySelector('button');submit.disabled=true;
    try{const {error}=await client.rpc('send_resona_direct_message',{p_friend_id:activeFriend.user_id,p_body:body});if(error)throw error;$('socialChatInput').value='';await loadDMs();}
    catch(e){status(e.message||'Could not send message.','error');}
    finally{submit.disabled=false;}
  }
  async function reportMessage(type,id) {
    const reason=prompt('Briefly describe why you are reporting this message:');
    if(!reason)return;
    try{const {error}=await client.rpc('report_resona_message',{p_message_type:type,p_message_id:id,p_reason:reason});if(error)throw error;status('Report submitted.','success');}
    catch(e){status(e.message||'Could not submit report.','error');}
  }
  async function deleteRoomMessage(id) {
    try{const {error}=await client.rpc('delete_resona_room_message',{p_message_id:id});if(error)throw error;await loadRoomMessages();status('Message removed.','success');}
    catch(e){status(e.message||'Could not remove message.','error');}
  }
  async function loadRoomMessages() {
    if(!activeRoom)return;
    const {data,error}=await client.from('resona_room_messages').select('*').eq('room_id',activeRoom.id)
      .gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:true}).limit(100);
    if(error)throw error;renderMessages($('roomChatMessages'),data||[],true);
  }
  async function sendRoomMessage(event) {
    event.preventDefault();if(!activeRoom)return;
    const body=$('roomChatInput').value.trim();if(!body)return;
    const submit=$('roomChatForm').querySelector('button');submit.disabled=true;
    try{const {error}=await client.rpc('send_resona_room_message',{p_room_id:activeRoom.id,p_body:body});if(error)throw error;$('roomChatInput').value='';await loadRoomMessages();}
    catch(e){status(e.message||'Could not send room message.','error');}
    finally{submit.disabled=false;}
  }
  async function openRoomChat(room) {
    try{
      await connect();activeRoom=room;
      if(roomChannel)await client.removeChannel(roomChannel);
      await loadRoomMessages();
      roomChannel=client.channel('resona-room-chat-'+room.id)
        .on('postgres_changes',{event:'*',schema:'public',table:'resona_room_messages',filter:'room_id=eq.'+room.id},()=>loadRoomMessages())
        .subscribe();
    }catch(e){const box=$('roomChatMessages');if(box)box.innerHTML='<div class="rooms-empty">'+esc(e.message||'Room chat unavailable. Run the Social SQL setup.')+'</div>';}
  }
  async function inviteToRoom(roomId) {
    try{
      await connect();
      const {data:friendships,error}=await client.from('resona_friendships').select('requester_id,addressee_id')
        .eq('status','accepted').or('requester_id.eq.'+user.id+',addressee_id.eq.'+user.id);
      if(error)throw error;
      const ids=(friendships||[]).map(x=>x.requester_id===user.id?x.addressee_id:x.requester_id);
      const friends=await profilesByIds(ids);
      const box=$('roomInviteFriendsList');box.replaceChildren();
      if(!friends.length){box.innerHTML='<div class="rooms-empty">Add friends in Resona Social before inviting them.</div>';}
      friends.forEach(p=>{
        const el=row(p,p.bio||'Friend');
        el.append(button('Invite','btn small primary',async()=>{
          try{const {error}=await client.rpc('invite_resona_friend_to_room',{p_room_id:roomId,p_friend_id:p.user_id});if(error)throw error;status('Room invitation sent to '+nameOf(p)+'.','success');}
          catch(e){status(e.message||'Could not invite this friend.','error');}
        }));
        box.append(el);
      });
      $('roomInviteFriendsPanel').classList.remove('hidden');
    }catch(e){status(e.message||'Could not load your friends.','error');}
  }
  $('createCollabPlaylistBtn')?.addEventListener('click',createCollaborativePlaylist);
  $('activitySharingToggle')?.addEventListener('change', event => setActivitySharing(event.target.checked));
  $('socialSignInBtn')?.addEventListener('click',()=> $('accountBtn')?.click());
  $('socialSearchBtn')?.addEventListener('click',searchPeople);
  $('socialSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')searchPeople();});
  $('socialChatForm')?.addEventListener('submit',sendDM);
  $('roomChatForm')?.addEventListener('submit',sendRoomMessage);
  $('roomInviteFriendsBtn')?.addEventListener('click',()=>{if(activeRoom)inviteToRoom(activeRoom.id);});
  $('roomInviteFriendsClose')?.addEventListener('click',()=>$('roomInviteFriendsPanel').classList.add('hidden'));
  $('roomCopyLinkBtn')?.addEventListener('click',async()=>{
    if(!activeRoom)return;
    const link=location.origin+location.pathname+'?room='+encodeURIComponent(activeRoom.invite_code);
    try{await navigator.clipboard.writeText(link);status('Room invite link copied.','success');}
    catch{status('Invite code: '+activeRoom.invite_code,'info');}
  });
  window.ResonaSocial={inviteToRoom,openRoomChat};
  window.addEventListener('resona:track-changed', event => publishCurrentTrack(event.detail?.track));
  window.addEventListener('resona:room-open',event=>{if(event.detail?.room)openRoomChat(event.detail.room);});
  window.addEventListener('resona:room-close',()=>{activeRoom=null;if(roomChannel&&client)client.removeChannel(roomChannel);roomChannel=null;});
  window.addEventListener('resona:auth-ready',event=>{user=event.detail?.user||null;connect().then(loadSocial).catch(e=>status(e.message,'error'));});
  window.addEventListener('resona:auth-changed',event=>{
    const next=event.detail?.user||null;
    if(user?.id!==next?.id){user=next;activeFriend=null;activeRoom=null;
      if(dmChannel&&client)client.removeChannel(dmChannel);dmChannel=null;
      if(roomChannel&&client)client.removeChannel(roomChannel);roomChannel=null;
      if(user)connect().then(async()=>{await loadSocial(); const {data}=await client.from('resona_friend_activity').select('sharing_enabled').eq('user_id',user.id).maybeSingle(); $('activitySharingToggle').checked=!!data?.sharing_enabled;}).catch(e=>status(e.message,'error'));else { signedInUI(); if($('activitySharingToggle'))$('activitySharingToggle').checked=false; }
    }
  });
  if(window.ResonaAccount?.getClient)connect().then(async()=>{await loadSocial();if(user){const {data}=await client.from('resona_friend_activity').select('sharing_enabled').eq('user_id',user.id).maybeSingle();$('activitySharingToggle').checked=!!data?.sharing_enabled;}}).catch(()=>{});
  else signedInUI();
  document.querySelector('[data-view="social"]')?.addEventListener('click',()=>loadSocial().catch(e=>status(e.message||'Social could not load.','error')));
})();
