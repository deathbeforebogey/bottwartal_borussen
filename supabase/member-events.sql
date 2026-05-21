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

create table if not exists public.site_content (
  key text primary key,
  label text not null,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text not null,
  body text not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.member_events enable row level security;
alter table public.site_content enable row level security;
alter table public.articles enable row level security;
alter table public.site_sections enable row level security;

drop policy if exists "Members can read member events" on public.member_events;
drop policy if exists "Anyone can read site content" on public.site_content;
drop policy if exists "Anyone can read published articles" on public.articles;
drop policy if exists "Anyone can read visible site sections" on public.site_sections;

create policy "Members can read member events"
on public.member_events
for select
to authenticated
using (true);

create policy "Anyone can read site content"
on public.site_content
for select
to anon, authenticated
using (true);

create policy "Anyone can read published articles"
on public.articles
for select
to anon, authenticated
using (published = true);

create policy "Anyone can read visible site sections"
on public.site_sections
for select
to anon, authenticated
using (visible = true);

insert into public.member_events (event_date, day, month, event_time, title, description)
values
  ('2026-06-14', '14', 'Juni', '19:09 Uhr', 'Fanclub-Stammtisch', 'Offener Abend für Mitglieder, Freunde und Interessierte.'),
  ('2026-07-05', '05', 'Juli', '18:30 Uhr', 'Saisonplanung', 'Kartenwünsche, Fahrten, Treffpunkte und Fanclub-Aktionen.'),
  ('2026-08-15', '15', 'Aug', 'Matchday', 'Saisonauftakt', 'Gemeinsam in die neue Saison mit Tippspiel und Spieltagsrunde.')
on conflict do nothing;

insert into public.site_content (key, label, value)
values
  ('hero_eyebrow', 'Hero Unterzeile', 'Offiziell schwarzgelb im Bottwartal'),
  ('hero_title_top', 'Hero Titel Zeile 1', 'Bottwartal'),
  ('hero_title_bottom', 'Hero Titel Zeile 2', 'Borussen'),
  ('hero_lead', 'Hero Beschreibung', 'Eine Fanclub-Seite mit Spieltagsenergie: Treffpunkte, Termine, Fahrten, Gemeinschaft und alles, was den schwarzgelben Puls höher schlagen lässt.'),
  ('fanclub_title', 'Fanclub Überschrift', 'Mehr als Fußball schauen. Das ist unser gemeinsamer Spieltag.'),
  ('contact_title', 'Kontakt Überschrift', 'Bereit für Schwarzgelb im Bottwartal?')
on conflict (key) do nothing;

insert into public.articles (title, excerpt, body, published)
values
  ('Willkommen bei den Bottwartal Borussen', 'Der neue Webauftritt bündelt Fanclub-Infos, Termine und schwarzgelbe Momente.', 'Hier kann später ein längerer Artikeltext stehen.', true)
on conflict do nothing;

insert into public.site_sections (sort_order, type, eyebrow, title, body, button_label, button_url, visible)
values
  (10, 'highlight', 'Fanclub', 'Schwarzgelb im Bottwartal', 'Dieser Block kommt aus dem Sitebuilder und kann im Adminbereich ohne Code bearbeitet, ausgeblendet oder neu sortiert werden.', 'Mitglied werden', '#kontakt', true),
  (20, 'split', 'Spieltage', 'Gemeinsam statt allein schauen', 'Lege hier eigene Inhaltsblöcke für Fahrten, Rückblicke, Treffpunkte, Aktionen oder Fanclub-News an.', 'Termine ansehen', '#termine', true)
on conflict do nothing;
