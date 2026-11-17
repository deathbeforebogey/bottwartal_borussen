-- Komplettes Datenbank-Setup für die Bottwartal Borussen.
-- Im Supabase Dashboard unter "SQL Editor" einfügen und ausführen.
-- Kann gefahrlos mehrfach ausgeführt werden: Bestehende Daten bleiben erhalten.

-- Interne Termine (nur für eingeloggte Mitglieder sichtbar)
create table if not exists public.member_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  day text not null,
  month text not null,
  event_time text not null,
  title text not null,
  description text not null,
  created_at timestamptz not null default now()
);

-- Bearbeitbare Texte der Startseite
create table if not exists public.site_content (
  key text primary key,
  label text not null,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Meldungen / Artikel
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text not null,
  body text not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Zusätzliche Blöcke auf der Startseite (Builder)
create table if not exists public.site_sections (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null default 100,
  type text not null default 'highlight',
  eyebrow text not null default '',
  title text not null,
  body text not null default '',
  button_label text not null default '',
  button_url text not null default '',
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Zu-/Absagen der Mitglieder zu Terminen
create table if not exists public.event_rsvps (
  event_id uuid not null references public.member_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  status text not null check (status in ('yes', 'maybe', 'no')),
  comment text not null default '' check (char_length(comment) <= 300),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Protokoll aller Änderungen im Adminbereich (nur über den Server lesbar)
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  target_label text not null default '',
  details jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

-- Row Level Security: ohne passende Regel ist nichts erlaubt.
-- Schreiben in Termine, Texte, Artikel, Blöcke und Protokoll geht nur über den Server (Service Role).
alter table public.member_events enable row level security;
alter table public.site_content enable row level security;
alter table public.articles enable row level security;
alter table public.site_sections enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists "Members can read member events" on public.member_events;
drop policy if exists "Anyone can read site content" on public.site_content;
drop policy if exists "Anyone can read published articles" on public.articles;
drop policy if exists "Anyone can read visible site sections" on public.site_sections;
drop policy if exists "Members can read rsvps" on public.event_rsvps;
drop policy if exists "Members can add own rsvp" on public.event_rsvps;
drop policy if exists "Members can change own rsvp" on public.event_rsvps;
drop policy if exists "Members can remove own rsvp" on public.event_rsvps;

create policy "Members can read member events"
on public.member_events for select to authenticated using (true);

create policy "Anyone can read site content"
on public.site_content for select to anon, authenticated using (true);

create policy "Anyone can read published articles"
on public.articles for select to anon, authenticated using (published = true);

create policy "Anyone can read visible site sections"
on public.site_sections for select to anon, authenticated using (visible = true);

-- Alle Mitglieder sehen, wer kommt; schreiben darf jedes Mitglied nur seine eigene Antwort.
create policy "Members can read rsvps"
on public.event_rsvps for select to authenticated using (true);

create policy "Members can add own rsvp"
on public.event_rsvps for insert to authenticated with check (user_id = auth.uid());

create policy "Members can change own rsvp"
on public.event_rsvps for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Members can remove own rsvp"
on public.event_rsvps for delete to authenticated using (user_id = auth.uid());

-- Profile für Mitgliederliste und Profilseite: nur Anzeigename und Beitrittsdatum,
-- keine E-Mail-Adressen. Mitglieder sehen alle Profile, ändern aber nur ihr eigenes.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Members can read profiles" on public.profiles;
drop policy if exists "Members can change own profile" on public.profiles;

create policy "Members can read profiles"
on public.profiles for select to authenticated using (true);

-- Nur der Anzeigename darf geändert werden; id und Beitrittsdatum bleiben fest.
create policy "Members can change own profile"
on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- Neue Konten bekommen automatisch ein Profil.
create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, created_at)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 60),
    new.created_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_member();

-- Bestehende Konten nachtragen.
insert into public.profiles (id, display_name, created_at)
select
  id,
  left(coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), split_part(email, '@', 1)), 60),
  created_at
from auth.users
on conflict (id) do nothing;

-- Standardtexte der Startseite (entsprechen dem Text in index.html)
insert into public.site_content (key, label, value)
values
  ('hero_eyebrow', 'Hero Unterzeile', 'Offizieller BVB-Fanclub aus dem Bottwartal'),
  ('hero_title_top', 'Hero Titel Zeile 1', 'Bottwartal'),
  ('hero_title_bottom', 'Hero Titel Zeile 2', 'Borussen'),
  ('hero_lead', 'Hero Beschreibung', 'Unser Zuhause ist das Bottwartal. Unser Verein ist Borussia Dortmund. Hier findest du unsere Treffpunkte, Termine und gemeinsamen Fahrten.'),
  ('fanclub_title', 'Fanclub Überschrift', 'Bottwartal Borussen')
on conflict (key) do nothing;
