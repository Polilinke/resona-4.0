-- Resona Stage 3: friend activity and collaborative playlists.
-- Run once in Supabase SQL Editor. No YouTube API calls are involved.

create table if not exists public.resona_friend_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sharing_enabled boolean not null default false,
  track jsonb,
  updated_at timestamptz not null default now()
);

alter table public.resona_friend_activity enable row level security;

drop policy if exists "Users manage own activity" on public.resona_friend_activity;
create policy "Users manage own activity"
on public.resona_friend_activity for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Friends read shared activity" on public.resona_friend_activity;
create policy "Friends read shared activity"
on public.resona_friend_activity for select
to authenticated
using (
  sharing_enabled = true
  and exists (
    select 1 from public.resona_friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = resona_friend_activity.user_id)
        or
        (f.addressee_id = auth.uid() and f.requester_id = resona_friend_activity.user_id)
      )
  )
);

-- Collaborative playlist data model.
create table if not exists public.resona_collaborative_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resona_collaborative_playlist_members (
  playlist_id uuid not null references public.resona_collaborative_playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  added_at timestamptz not null default now(),
  primary key (playlist_id, user_id)
);

create table if not exists public.resona_collaborative_playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.resona_collaborative_playlists(id) on delete cascade,
  track jsonb not null,
  position integer not null default 0,
  added_by uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create index if not exists resona_collab_tracks_order_idx
  on public.resona_collaborative_playlist_tracks(playlist_id, position, added_at);

-- SECURITY DEFINER avoids recursive RLS checks when membership policies consult membership.
create or replace function public.is_resona_collab_member(p_playlist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resona_collaborative_playlists p
    where p.id = p_playlist_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.resona_collaborative_playlist_members m
    where m.playlist_id = p_playlist_id and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_resona_collab_member(uuid) from public;
grant execute on function public.is_resona_collab_member(uuid) to authenticated;

alter table public.resona_collaborative_playlists enable row level security;
alter table public.resona_collaborative_playlist_members enable row level security;
alter table public.resona_collaborative_playlist_tracks enable row level security;

drop policy if exists "Members read collaborative playlists" on public.resona_collaborative_playlists;
create policy "Members read collaborative playlists"
on public.resona_collaborative_playlists for select to authenticated
using (public.is_resona_collab_member(id));

drop policy if exists "Users create collaborative playlists" on public.resona_collaborative_playlists;
create policy "Users create collaborative playlists"
on public.resona_collaborative_playlists for insert to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Owners update collaborative playlists" on public.resona_collaborative_playlists;
create policy "Owners update collaborative playlists"
on public.resona_collaborative_playlists for update to authenticated
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owners delete collaborative playlists" on public.resona_collaborative_playlists;
create policy "Owners delete collaborative playlists"
on public.resona_collaborative_playlists for delete to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Members read playlist collaborators" on public.resona_collaborative_playlist_members;
create policy "Members read playlist collaborators"
on public.resona_collaborative_playlist_members for select to authenticated
using (public.is_resona_collab_member(playlist_id));

drop policy if exists "Owners manage playlist collaborators" on public.resona_collaborative_playlist_members;
drop policy if exists "Owners invite friends to playlists" on public.resona_collaborative_playlist_members;
drop policy if exists "Owners update playlist collaborators" on public.resona_collaborative_playlist_members;
drop policy if exists "Owners remove playlist collaborators" on public.resona_collaborative_playlist_members;

-- Only the playlist owner can invite, and the invited account must be an accepted friend.
create policy "Owners invite friends to playlists"
on public.resona_collaborative_playlist_members for insert to authenticated
with check (
  exists (select 1 from public.resona_collaborative_playlists p where p.id = playlist_id and p.owner_id = auth.uid())
  and exists (
    select 1 from public.resona_friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = user_id))
  )
);

create policy "Owners update playlist collaborators"
on public.resona_collaborative_playlist_members for update to authenticated
using (exists (select 1 from public.resona_collaborative_playlists p where p.id = playlist_id and p.owner_id = auth.uid()))
with check (exists (select 1 from public.resona_collaborative_playlists p where p.id = playlist_id and p.owner_id = auth.uid()));

create policy "Owners remove playlist collaborators"
on public.resona_collaborative_playlist_members for delete to authenticated
using (exists (select 1 from public.resona_collaborative_playlists p where p.id = playlist_id and p.owner_id = auth.uid()));

drop policy if exists "Members read collaborative tracks" on public.resona_collaborative_playlist_tracks;
create policy "Members read collaborative tracks"
on public.resona_collaborative_playlist_tracks for select to authenticated
using (public.is_resona_collab_member(playlist_id));

drop policy if exists "Members add collaborative tracks" on public.resona_collaborative_playlist_tracks;
create policy "Members add collaborative tracks"
on public.resona_collaborative_playlist_tracks for insert to authenticated
with check (public.is_resona_collab_member(playlist_id) and auth.uid() = added_by);

drop policy if exists "Members update collaborative tracks" on public.resona_collaborative_playlist_tracks;
create policy "Members update collaborative tracks"
on public.resona_collaborative_playlist_tracks for update to authenticated
using (public.is_resona_collab_member(playlist_id))
with check (public.is_resona_collab_member(playlist_id));

drop policy if exists "Members remove collaborative tracks" on public.resona_collaborative_playlist_tracks;
create policy "Members remove collaborative tracks"
on public.resona_collaborative_playlist_tracks for delete to authenticated
using (public.is_resona_collab_member(playlist_id));

-- Owner membership is inserted automatically for newly-created playlists.
create or replace function public.add_resona_collab_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.resona_collaborative_playlist_members(playlist_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (playlist_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists resona_collab_owner_after_insert on public.resona_collaborative_playlists;
create trigger resona_collab_owner_after_insert
after insert on public.resona_collaborative_playlists
for each row execute function public.add_resona_collab_owner();


-- Keep updated_at useful for ordering shared playlists.
create or replace function public.touch_resona_collab_playlist_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists resona_collab_playlist_touch on public.resona_collaborative_playlists;
create trigger resona_collab_playlist_touch
before update on public.resona_collaborative_playlists
for each row execute function public.touch_resona_collab_playlist_updated_at();

-- Enable Realtime for social activity and shared playlist changes when not already published.
do $$
declare t text;
begin
  foreach t in array array['resona_friend_activity','resona_collaborative_playlists','resona_collaborative_playlist_members','resona_collaborative_playlist_tracks'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
