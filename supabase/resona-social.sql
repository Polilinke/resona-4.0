-- Resona Social migration
-- Run once in Supabase SQL Editor after listening-rooms.sql.
-- Private friend messaging, room chat, friend invitations, moderation and 7-day retention.

create table if not exists public.resona_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Listener',
  bio text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.sync_resona_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.resona_profiles(user_id, display_name, bio, updated_at)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''), split_part(coalesce(new.email,''),'@',1), 'Listener'),
    left(coalesce(new.raw_user_meta_data->>'bio',''),180),
    now()
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    bio = excluded.bio,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists resona_profile_auth_sync on auth.users;
create trigger resona_profile_auth_sync
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.sync_resona_profile();

insert into public.resona_profiles(user_id,display_name,bio)
select id,
  coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''), split_part(coalesce(email,''),'@',1), 'Listener'),
  left(coalesce(raw_user_meta_data->>'bio',''),180)
from auth.users
on conflict (user_id) do update set
  display_name=excluded.display_name,bio=excluded.bio,updated_at=now();

create table if not exists public.resona_friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id),
  unique(requester_id,addressee_id)
);

create table if not exists public.resona_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check(blocker_id <> blocked_id)
);

create table if not exists public.resona_direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check(sender_id <> recipient_id)
);

create table if not exists public.resona_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Listener',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.resona_room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check(inviter_id <> invitee_id)
);
create unique index if not exists resona_room_invite_pending_unique
on public.resona_room_invites(room_id,invitee_id) where status='pending';

create table if not exists public.resona_message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  message_type text not null check(message_type in ('direct','room')),
  message_id uuid not null,
  reason text not null check(char_length(reason) between 3 and 300),
  created_at timestamptz not null default now(),
  status text not null default 'open' check(status in ('open','reviewed','dismissed'))
);

create index if not exists resona_friendships_addressee_idx on public.resona_friendships(addressee_id,status);
create index if not exists resona_direct_messages_pair_idx on public.resona_direct_messages(sender_id,recipient_id,created_at desc);
create index if not exists resona_room_messages_room_idx on public.resona_room_messages(room_id,created_at desc);
create index if not exists resona_room_invites_invitee_idx on public.resona_room_invites(invitee_id,status,created_at desc);

alter table public.resona_profiles enable row level security;
alter table public.resona_friendships enable row level security;
alter table public.resona_blocks enable row level security;
alter table public.resona_direct_messages enable row level security;
alter table public.resona_room_messages enable row level security;
alter table public.resona_room_invites enable row level security;
alter table public.resona_message_reports enable row level security;

drop policy if exists "Profiles visible to signed in users" on public.resona_profiles;
create policy "Profiles visible to signed in users" on public.resona_profiles
for select to authenticated using (true);
drop policy if exists "Users view their friendships" on public.resona_friendships;
create policy "Users view their friendships" on public.resona_friendships
for select to authenticated using (auth.uid() in (requester_id,addressee_id));
drop policy if exists "Users view their own blocks" on public.resona_blocks;
create policy "Users view their own blocks" on public.resona_blocks
for select to authenticated using (auth.uid()=blocker_id);
drop policy if exists "Friends can read recent direct messages" on public.resona_direct_messages;
create policy "Friends can read recent direct messages" on public.resona_direct_messages
for select to authenticated using (
  auth.uid() in (sender_id,recipient_id)
  and created_at > now() - interval '7 days'
  and exists (
    select 1 from public.resona_friendships f
    where f.status='accepted'
      and ((f.requester_id=sender_id and f.addressee_id=recipient_id)
        or (f.requester_id=recipient_id and f.addressee_id=sender_id))
  )
);
drop policy if exists "Room members can read recent room chat" on public.resona_room_messages;
create policy "Room members can read recent room chat" on public.resona_room_messages
for select to authenticated using (
  created_at > now() - interval '7 days'
  and public.is_listening_room_member(room_id)
);
drop policy if exists "Users view invites sent or received" on public.resona_room_invites;
create policy "Users view invites sent or received" on public.resona_room_invites
for select to authenticated using (auth.uid() in (inviter_id,invitee_id));
drop policy if exists "Users view own reports" on public.resona_message_reports;
create policy "Users view own reports" on public.resona_message_reports
for select to authenticated using (auth.uid()=reporter_id);

create or replace function public.search_resona_people(p_query text)
returns table(user_id uuid,display_name text,bio text,friendship_status text,request_direction text)
language plpgsql stable security definer set search_path=public
as $$
declare v_query text := left(trim(coalesce(p_query,'')),60);
begin
  if auth.uid() is null then raise exception 'Sign in to find friends.'; end if;
  if char_length(v_query)<2 then return; end if;
  return query
  select p.user_id,p.display_name,p.bio,
    case when f.status='accepted' then 'friends'
         when f.status='pending' then 'pending' else 'none' end,
    case when f.requester_id=auth.uid() then 'sent'
         when f.addressee_id=auth.uid() then 'received' else '' end
  from public.resona_profiles p
  left join public.resona_friendships f
    on ((f.requester_id=auth.uid() and f.addressee_id=p.user_id)
      or (f.requester_id=p.user_id and f.addressee_id=auth.uid()))
  where p.user_id<>auth.uid()
    and p.display_name ilike '%'||v_query||'%'
    and not exists(select 1 from public.resona_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id)
         or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
  order by p.display_name limit 25;
end;
$$;

create or replace function public.send_resona_friend_request(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_existing public.resona_friendships;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_user_id=auth.uid() then raise exception 'You cannot add yourself.'; end if;
  if not exists(select 1 from public.resona_profiles where user_id=p_user_id) then raise exception 'That profile was not found.'; end if;
  if exists(select 1 from public.resona_blocks b where
    (b.blocker_id=auth.uid() and b.blocked_id=p_user_id) or
    (b.blocker_id=p_user_id and b.blocked_id=auth.uid())) then raise exception 'This friend request is unavailable.'; end if;
  select * into v_existing from public.resona_friendships
    where (requester_id=auth.uid() and addressee_id=p_user_id)
       or (requester_id=p_user_id and addressee_id=auth.uid()) for update;
  if found then
    if v_existing.status='accepted' then return jsonb_build_object('status','friends'); end if;
    if v_existing.requester_id=p_user_id then
      update public.resona_friendships set status='accepted',accepted_at=now() where id=v_existing.id;
      return jsonb_build_object('status','accepted');
    end if;
    return jsonb_build_object('status','pending');
  end if;
  insert into public.resona_friendships(requester_id,addressee_id)
  values(auth.uid(),p_user_id);
  return jsonb_build_object('status','pending');
end;
$$;

create or replace function public.respond_resona_friend_request(p_request_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row public.resona_friendships;
begin
  select * into v_row from public.resona_friendships
    where id=p_request_id and addressee_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'That friend request is no longer available.'; end if;
  if p_accept then
    update public.resona_friendships set status='accepted',accepted_at=now() where id=p_request_id;
  else
    delete from public.resona_friendships where id=p_request_id;
  end if;
  return jsonb_build_object('accepted',p_accept);
end;
$$;

create or replace function public.remove_resona_friend(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
begin
  delete from public.resona_friendships where status='accepted'
    and ((requester_id=auth.uid() and addressee_id=p_user_id)
      or (requester_id=p_user_id and addressee_id=auth.uid()));
  return jsonb_build_object('removed',true);
end;
$$;

create or replace function public.block_resona_user(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or p_user_id=auth.uid() then raise exception 'Invalid block request.'; end if;
  insert into public.resona_blocks(blocker_id,blocked_id) values(auth.uid(),p_user_id)
  on conflict do nothing;
  delete from public.resona_friendships where
    (requester_id=auth.uid() and addressee_id=p_user_id)
    or (requester_id=p_user_id and addressee_id=auth.uid());
  return jsonb_build_object('blocked',true);
end;
$$;

create or replace function public.send_resona_direct_message(p_friend_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_body text:=trim(coalesce(p_body,''));
declare v_row public.resona_direct_messages;
begin
  if auth.uid() is null then raise exception 'Sign in to send messages.'; end if;
  if char_length(v_body)<1 or char_length(v_body)>1000 then raise exception 'Messages must be 1–1000 characters.'; end if;
  if (select count(*) from public.resona_direct_messages where sender_id=auth.uid() and created_at>now()-interval '15 seconds')>=8 then raise exception 'Please slow down before sending another message.'; end if;
  if not exists(select 1 from public.resona_friendships f where f.status='accepted'
    and ((f.requester_id=auth.uid() and f.addressee_id=p_friend_id)
      or (f.requester_id=p_friend_id and f.addressee_id=auth.uid())) then
    raise exception 'You can only message accepted friends.';
  end if;
  if exists(select 1 from public.resona_blocks b where
    (b.blocker_id=auth.uid() and b.blocked_id=p_friend_id)
    or (b.blocker_id=p_friend_id and b.blocked_id=auth.uid())) then raise exception 'Messaging is unavailable.'; end if;
  delete from public.resona_direct_messages where created_at < now()-interval '7 days';
  insert into public.resona_direct_messages(sender_id,recipient_id,body)
    values(auth.uid(),p_friend_id,v_body) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.send_resona_room_message(p_room_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_body text:=trim(coalesce(p_body,''));
declare v_row public.resona_room_messages;
declare v_name text;
begin
  if auth.uid() is null or not public.is_listening_room_member(p_room_id) then raise exception 'Join the room before chatting.'; end if;
  if char_length(v_body)<1 or char_length(v_body)>1000 then raise exception 'Messages must be 1–1000 characters.'; end if;
  if (select count(*) from public.resona_room_messages where user_id=auth.uid() and created_at>now()-interval '15 seconds')>=8 then raise exception 'Please wait a moment before sending more messages.'; end if;
  if not exists(select 1 from public.listening_rooms where id=p_room_id and status='active') then raise exception 'This room is closed.'; end if;
  select display_name into v_name from public.resona_profiles where user_id=auth.uid();
  delete from public.resona_room_messages where created_at < now()-interval '7 days';
  insert into public.resona_room_messages(room_id,user_id,display_name,body)
  values(p_room_id,auth.uid(),coalesce(v_name,'Listener'),v_body) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_resona_room_message(p_message_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row public.resona_room_messages;
begin
  select * into v_row from public.resona_room_messages where id=p_message_id for update;
  if not found then return jsonb_build_object('deleted',false); end if;
  if v_row.user_id<>auth.uid() and not exists(
    select 1 from public.listening_rooms r where r.id=v_row.room_id and r.host_id=auth.uid()
  ) then raise exception 'Only the author or room host can remove this message.'; end if;
  delete from public.resona_room_messages where id=p_message_id;
  return jsonb_build_object('deleted',true);
end;
$$;

create or replace function public.invite_resona_friend_to_room(p_room_id uuid,p_friend_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row public.resona_room_invites;
begin
  if not public.is_listening_room_member(p_room_id) then raise exception 'Only room members can invite friends.'; end if;
  if not exists(select 1 from public.listening_rooms where id=p_room_id and status='active') then raise exception 'This room is closed.'; end if;
  if not exists(select 1 from public.resona_friendships f where f.status='accepted'
    and ((f.requester_id=auth.uid() and f.addressee_id=p_friend_id)
      or (f.requester_id=p_friend_id and f.addressee_id=auth.uid()))) then
    raise exception 'You can only invite accepted friends.';
  end if;
  insert into public.resona_room_invites(room_id,inviter_id,invitee_id)
    values(p_room_id,auth.uid(),p_friend_id)
    on conflict (room_id,invitee_id) where status='pending'
    do update set inviter_id=excluded.inviter_id,created_at=now()
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.respond_resona_room_invite(p_invite_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row public.resona_room_invites;
declare v_room public.listening_rooms;
declare v_name text;
begin
  select * into v_row from public.resona_room_invites
    where id=p_invite_id and invitee_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'That room invitation is no longer available.'; end if;
  if not p_accept then
    update public.resona_room_invites set status='declined',responded_at=now() where id=p_invite_id;
    return jsonb_build_object('accepted',false);
  end if;
  select * into v_room from public.listening_rooms where id=v_row.room_id and status='active';
  if not found then raise exception 'This room has closed.'; end if;
  select coalesce(nullif(display_name,''),'Listener') into v_name from public.resona_profiles where user_id=auth.uid();
  insert into public.listening_room_members(room_id,user_id,display_name)
    values(v_row.room_id,auth.uid(),coalesce(v_name,'Listener')) on conflict do nothing;
  update public.resona_room_invites set status='accepted',responded_at=now() where id=p_invite_id;
  return jsonb_build_object('accepted',true,'room_id',v_room.id,'room_name',v_room.name,'invite_code',v_room.invite_code);
end;
$$;

create or replace function public.report_resona_message(p_message_type text,p_message_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_reason text:=trim(coalesce(p_reason,''));
begin
  if auth.uid() is null then raise exception 'Sign in to report content.'; end if;
  if p_message_type not in ('direct','room') then raise exception 'Invalid report type.'; end if;
  if char_length(v_reason)<3 or char_length(v_reason)>300 then raise exception 'Please provide a short reason (3–300 characters).'; end if;
  if p_message_type='room' and not exists(select 1 from public.resona_room_messages m
    where m.id=p_message_id and public.is_listening_room_member(m.room_id)) then raise exception 'Message not found.'; end if;
  if p_message_type='direct' and not exists(select 1 from public.resona_direct_messages m
    where m.id=p_message_id and auth.uid() in (m.sender_id,m.recipient_id)) then raise exception 'Message not found.'; end if;
  insert into public.resona_message_reports(reporter_id,message_type,message_id,reason)
    values(auth.uid(),p_message_type,p_message_id,v_reason);
  return jsonb_build_object('reported',true);
end;
$$;

create or replace function public.purge_expired_resona_messages()
returns integer language plpgsql security definer set search_path=public
as $$
declare v_direct_count integer;
declare v_room_count integer;
begin
  delete from public.resona_direct_messages where created_at < now()-interval '7 days';
  get diagnostics v_direct_count = row_count;
  delete from public.resona_room_messages where created_at < now()-interval '7 days';
  get diagnostics v_room_count = row_count;
  return v_direct_count + v_room_count;
end;
$$;

-- Keep the purge function callable by the database scheduler, not browser clients.
revoke all on function public.purge_expired_resona_messages() from public, anon, authenticated;

revoke all on function public.sync_resona_profile() from public, anon, authenticated;
revoke all on function public.search_resona_people(text) from public, anon;
revoke all on function public.send_resona_friend_request(uuid) from public, anon;
revoke all on function public.respond_resona_friend_request(uuid,boolean) from public, anon;
revoke all on function public.remove_resona_friend(uuid) from public, anon;
revoke all on function public.block_resona_user(uuid) from public, anon;
revoke all on function public.send_resona_direct_message(uuid,text) from public, anon;
revoke all on function public.send_resona_room_message(uuid,text) from public, anon;
revoke all on function public.delete_resona_room_message(uuid) from public, anon;
revoke all on function public.invite_resona_friend_to_room(uuid,uuid) from public, anon;
revoke all on function public.respond_resona_room_invite(uuid,boolean) from public, anon;
revoke all on function public.report_resona_message(text,uuid,text) from public, anon;

grant execute on function public.search_resona_people(text) to authenticated;
grant execute on function public.send_resona_friend_request(uuid) to authenticated;
grant execute on function public.respond_resona_friend_request(uuid,boolean) to authenticated;
grant execute on function public.remove_resona_friend(uuid) to authenticated;
grant execute on function public.block_resona_user(uuid) to authenticated;
grant execute on function public.send_resona_direct_message(uuid,text) to authenticated;
grant execute on function public.send_resona_room_message(uuid,text) to authenticated;
grant execute on function public.delete_resona_room_message(uuid) to authenticated;
grant execute on function public.invite_resona_friend_to_room(uuid,uuid) to authenticated;
grant execute on function public.respond_resona_room_invite(uuid,boolean) to authenticated;
grant execute on function public.report_resona_message(text,uuid,text) to authenticated;
grant select on public.resona_profiles,public.resona_friendships,public.resona_blocks,
  public.resona_direct_messages,public.resona_room_messages,public.resona_room_invites,
  public.resona_message_reports to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.resona_friendships;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.resona_direct_messages;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.resona_room_messages;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.resona_room_invites;
exception when duplicate_object then null;
end $$;

-- Optional scheduled purge. If pg_cron is not enabled in this Supabase project,
-- the app still hides messages older than 7 days and the send RPC purges old rows.
do $$
begin
  create extension if not exists pg_cron;
  if not exists(select 1 from cron.job where jobname='resona-purge-expired-messages') then
    perform cron.schedule('resona-purge-expired-messages','15 * * * *',
      'select public.purge_expired_resona_messages();');
  end if;
exception when others then
  raise notice 'pg_cron unavailable; expired messages remain hidden and are purged on new sends.';
end $$;
