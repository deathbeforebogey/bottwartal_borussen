-- Zu-/Absagen der Mitglieder zu internen Terminen.
-- Einmal im Supabase SQL Editor ausführen (nach member-events.sql).

create table if not exists public.event_rsvps (
  event_id uuid not null references public.member_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  status text not null check (status in ('yes', 'maybe', 'no')),
  comment text not null default '' check (char_length(comment) <= 300),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_rsvps enable row level security;

drop policy if exists "Members can read rsvps" on public.event_rsvps;
drop policy if exists "Members can add own rsvp" on public.event_rsvps;
drop policy if exists "Members can change own rsvp" on public.event_rsvps;
drop policy if exists "Members can remove own rsvp" on public.event_rsvps;

-- Alle eingeloggten Mitglieder sehen, wer kommt.
create policy "Members can read rsvps"
on public.event_rsvps
for select
to authenticated
using (true);

-- Schreiben darf jedes Mitglied nur seine eigene Antwort.
create policy "Members can add own rsvp"
on public.event_rsvps
for insert
to authenticated
with check (user_id = auth.uid());

create policy "Members can change own rsvp"
on public.event_rsvps
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Members can remove own rsvp"
on public.event_rsvps
for delete
to authenticated
using (user_id = auth.uid());
