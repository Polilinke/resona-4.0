-- Resona Listening Rooms
-- Run this file once in Supabase Dashboard -> SQL Editor.
create table if not exists public.listening_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  name text not null check (char_length(name) between 2 and 48),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','closed')),
  current_track jsonb,
  playback_state text not null default 'paused' check (playback_state in ('playing','paused')),
  playback_position numeric not null default 0 check (playback_position >= 0),
  playback_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.listening_room_members (
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Listener',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.listening_room_suggestions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  track jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create table if not exists public.listening_room_queue (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  track jsonb not null,
  added_by uuid not null references auth.users(id),
  suggestion_id uuid unique references public.listening_room_suggestions(id) on delete set null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (room_id, position)
);

alter table public.listening_rooms
  add column if not exists current_queue_item_id uuid references public.listening_room_queue(id) on delete set null;

create index if not exists listening_room_members_user_idx on public.listening_room_members(user_id);
create index if not exists listening_room_suggestions_room_status_idx on public.listening_room_suggestions(room_id, status, created_at);
create index if not exists listening_room_queue_room_position_idx on public.listening_room_queue(room_id, position);

create or replace function public.is_listening_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.listening_room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_listening_room_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.listening_rooms
    where id = p_room_id and host_id = auth.uid() and status = 'active'
  );
$$;

alter table public.listening_rooms enable row level security;
alter table public.listening_room_members enable row level security;
alter table public.listening_room_suggestions enable row level security;
alter table public.listening_room_queue enable row level security;

drop policy if exists "Room members can view their rooms" on public.listening_rooms;
create policy "Room members can view their rooms" on public.listening_rooms
for select to authenticated using (public.is_listening_room_member(id));

drop policy if exists "Only the host can update room playback" on public.listening_rooms;
create policy "Only the host can update room playback" on public.listening_rooms
for update to authenticated using (public.is_listening_room_host(id))
with check (public.is_listening_room_host(id));

drop policy if exists "Room members can view members" on public.listening_room_members;
create policy "Room members can view members" on public.listening_room_members
for select to authenticated using (public.is_listening_room_member(room_id));

drop policy if exists "Room members can view suggestions" on public.listening_room_suggestions;
create policy "Room members can view suggestions" on public.listening_room_suggestions
for select to authenticated using (public.is_listening_room_member(room_id));

drop policy if exists "Members can suggest tracks" on public.listening_room_suggestions;
drop policy if exists "Hosts can review suggestions" on public.listening_room_suggestions;

drop policy if exists "Room members can view shared queue" on public.listening_room_queue;
create policy "Room members can view shared queue" on public.listening_room_queue
for select to authenticated using (public.is_listening_room_member(room_id));

create or replace function public.create_listening_room(p_name text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_room public.listening_rooms;
  v_code text;
  v_name text := trim(coalesce(p_name, ''));
  v_display text;
begin
  if auth.uid() is null then raise exception 'Sign in to create a room.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 48 then
    raise exception 'Room name must be between 2 and 48 characters.';
  end if;
  select coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(email,'@',1), 'Listener')
    into v_display from auth.users where id = auth.uid();
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.listening_rooms where invite_code = v_code);
  end loop;
  insert into public.listening_rooms(invite_code, name, host_id)
    values (v_code, v_name, auth.uid()) returning * into v_room;
  insert into public.listening_room_members(room_id, user_id, display_name)
    values (v_room.id, auth.uid(), coalesce(v_display, 'Listener'));
  return jsonb_build_object('id',v_room.id,'invite_code',v_room.invite_code,'name',v_room.name,'host_id',v_room.host_id);
end;
$$;

create or replace function public.join_listening_room(p_invite_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_room public.listening_rooms;
  v_display text;
begin
  if auth.uid() is null then raise exception 'Sign in to join a room.'; end if;
  select * into v_room from public.listening_rooms
    where invite_code = upper(trim(coalesce(p_invite_code,''))) and status = 'active';
  if not found then raise exception 'That invite code is invalid or the room has closed.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(email,'@',1), 'Listener')
    into v_display from auth.users where id = auth.uid();
  insert into public.listening_room_members(room_id, user_id, display_name)
    values (v_room.id, auth.uid(), coalesce(v_display,'Listener'))
    on conflict (room_id,user_id) do nothing;
  return jsonb_build_object('id',v_room.id,'invite_code',v_room.invite_code,'name',v_room.name,'host_id',v_room.host_id);
end;
$$;

create or replace function public.submit_listening_room_suggestion(p_room_id uuid, p_track jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.listening_room_suggestions;
declare v_source text;
begin
  if not public.is_listening_room_member(p_room_id) then raise exception 'Join this room before suggesting a track.'; end if;
  if p_track is null or coalesce(p_track->>'title','') = '' then raise exception 'Track information is incomplete.'; end if;
  v_source := coalesce(p_track->>'source','youtube');
  if v_source not in ('youtube','audius','archive','jamendo') then
    raise exception 'This track source cannot be shared in a room. Local files are only available on your device.';
  end if;
  insert into public.listening_room_suggestions(room_id,user_id,track)
    values (p_room_id,auth.uid(),p_track) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.review_listening_room_suggestion(p_suggestion_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.listening_room_suggestions;
declare v_next integer;
begin
  select * into v_row from public.listening_room_suggestions
    where id = p_suggestion_id for update;
  if not found then raise exception 'Suggestion not found.'; end if;
  if not public.is_listening_room_host(v_row.room_id) then raise exception 'Only the host can approve or reject suggestions.'; end if;
  if v_row.status <> 'pending' then raise exception 'This suggestion has already been reviewed.'; end if;
  update public.listening_room_suggestions
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_suggestion_id returning * into v_row;
  if p_approve then
    select coalesce(max(position),0) + 1 into v_next
      from public.listening_room_queue where room_id = v_row.room_id;
    insert into public.listening_room_queue(room_id,track,added_by,suggestion_id,position)
      values (v_row.room_id,v_row.track,v_row.user_id,v_row.id,v_next);
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.play_listening_room_queue_item(p_room_id uuid, p_queue_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_item public.listening_room_queue;
declare v_room public.listening_rooms;
begin
  if not public.is_listening_room_host(p_room_id) then raise exception 'Only the host can control room playback.'; end if;
  select * into v_item from public.listening_room_queue
    where id = p_queue_item_id and room_id = p_room_id;
  if not found then raise exception 'That track is no longer in the room queue.'; end if;
  update public.listening_rooms set current_track = v_item.track,
    current_queue_item_id = v_item.id, playback_state = 'playing',
    playback_position = 0, playback_updated_at = now()
    where id = p_room_id returning * into v_room;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.control_listening_room_playback(p_room_id uuid, p_state text, p_position numeric)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_room public.listening_rooms;
begin
  if not public.is_listening_room_host(p_room_id) then raise exception 'Only the host can control room playback.'; end if;
  if p_state not in ('playing','paused') then raise exception 'Invalid playback state.'; end if;
  update public.listening_rooms set playback_state = p_state,
    playback_position = greatest(0,coalesce(p_position,0)),
    playback_updated_at = now()
    where id = p_room_id returning * into v_room;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.leave_listening_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_is_host boolean;
begin
  select host_id = auth.uid() into v_is_host from public.listening_rooms where id = p_room_id and status = 'active';
  if not found then return jsonb_build_object('closed',true); end if;
  if v_is_host then
    update public.listening_rooms set status = 'closed', playback_state = 'paused',
      playback_updated_at = now() where id = p_room_id;
    return jsonb_build_object('closed',true);
  end if;
  delete from public.listening_room_members where room_id = p_room_id and user_id = auth.uid();
  return jsonb_build_object('closed',false);
end;
$$;

revoke all on function public.is_listening_room_member(uuid) from public, anon;
revoke all on function public.is_listening_room_host(uuid) from public, anon;
revoke all on function public.create_listening_room(text) from public, anon;
revoke all on function public.join_listening_room(text) from public, anon;
revoke all on function public.submit_listening_room_suggestion(uuid,jsonb) from public, anon;
revoke all on function public.review_listening_room_suggestion(uuid,boolean) from public, anon;
revoke all on function public.play_listening_room_queue_item(uuid,uuid) from public, anon;
revoke all on function public.control_listening_room_playback(uuid,text,numeric) from public, anon;
revoke all on function public.leave_listening_room(uuid) from public, anon;
grant execute on function public.is_listening_room_member(uuid) to authenticated;
grant execute on function public.is_listening_room_host(uuid) to authenticated;
grant execute on function public.create_listening_room(text) to authenticated;
grant execute on function public.join_listening_room(text) to authenticated;
grant execute on function public.submit_listening_room_suggestion(uuid,jsonb) to authenticated;
grant execute on function public.review_listening_room_suggestion(uuid,boolean) to authenticated;
grant execute on function public.play_listening_room_queue_item(uuid,uuid) to authenticated;
grant execute on function public.control_listening_room_playback(uuid,text,numeric) to authenticated;
grant execute on function public.leave_listening_room(uuid) to authenticated;

grant select on public.listening_rooms, public.listening_room_members,
  public.listening_room_suggestions, public.listening_room_queue to authenticated;
grant update on public.listening_rooms to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.listening_rooms;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.listening_room_members;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.listening_room_suggestions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.listening_room_queue;
exception when duplicate_object then null;
end $$;
