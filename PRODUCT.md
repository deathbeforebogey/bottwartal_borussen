# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Besucher:innen der öffentlichen Seite:** BVB-Fans aus dem Bottwartal und Umgebung, die den Fanclub kennenlernen, das nächste BVB-Spiel sehen oder Kontakt aufnehmen wollen. Meist auf dem Handy, oft über einen geteilten Link.
- **Mitglieder:** eingeloggte Fanclub-Mitglieder. Sie schauen vor Treffen und Spieltagen nach, was ansteht, sagen zu oder ab, sprechen Mitfahrgelegenheiten ab und lesen Fanclub-Meldungen. Überwiegend mobil, häufig kurz vor einem Termin.
- **Admins (Vorstand):** pflegen Startseiten-Texte, Blöcke, Artikel, Termine und Mitgliederkonten.

## Product Purpose

Die Website ist das Zuhause der Bottwartal Borussen im Netz: öffentlich die Visitenkarte des Fanclubs mit dem nächsten BVB-Spiel und einem Kontaktweg, intern der Treffpunkt der Mitglieder für Termine, Zusagen, Mitfahrten und Neuigkeiten. Erfolg bedeutet, dass Mitglieder die Seite vor jedem Treffen von sich aus öffnen und Interessierte ohne Umweg Kontakt aufnehmen.

## Positioning

Kein Vereinsportal von der Stange: Es ist der eigene Raum eines kleinen, lokalen Fanclubs. Wer kommt mit, wer fährt, wann geht es los. Das alles mit Namen, die man kennt.

## Operating Context

- Spieltage, Fanclub-Treffen und gemeinsame Fahrten sind der Takt; der Kicktipp-Tippspiel-Link gehört dazu.
- Konten legen Admins an (keine Selbstregistrierung). Mitglieder melden sich mit E-Mail und Passwort an.
- Spielplan-Daten kommen von OpenLigaDB.

## Capabilities and Constraints

- Node.js-Server ohne Framework (`server.js`), statische HTML/CSS/JS-Seiten, Supabase (Auth + Postgres mit RLS).
- Mitgliederbereich (bestätigt 2026-11-17): Spieltag-Zentrale (nächstes Spiel, nächster Termin, Neuigkeiten), Termine mit Zu-/Absage und Kommentar für Mitfahrten, Mitgliederliste (nur Anzeigenamen und „Mitglied seit“, keine E-Mail-Adressen), eigenes Profil (Anzeigename, Passwort, eigene Zusagen).
- Datenbankänderungen erfolgen über `supabase/setup.sql`, das mehrfach ausführbar bleiben muss.
- Deutsch als einzige Sprache.

## Brand Commitments

- Name: Bottwartal Borussen, offizieller BVB-Fanclub aus dem Bottwartal.
- Farben Schwarz und Gelb, das Vereinslogo (`assets/fanclub-logo.jpeg`) und die Plakatschrift Anton bleiben (vom Nutzer bestätigt).
- Ton: direkt, herzlich, per Du, ohne Werbesprache.
- Die Website ist kein offizielles Angebot der Borussia Dortmund GmbH & Co. KGaA.

## Evidence on Hand

- Logo: `assets/fanclub-logo.jpeg` (640×640).
- Kontakt: bottwartal.borussen09@web.de; Kicktipp: kicktipp.de/bottwartal-borussen.
- Keine Fotos, Mitgliederzahlen, Gründungsjahre oder Zitate vorhanden: nichts davon erfinden.
- Impressum und Datenschutz enthalten noch Platzhalter (VORNAME NACHNAME usw.), die der Verein ausfüllen muss.

## Product Principles

1. Das Nächste zuerst: nächstes Spiel, nächster Termin, meine Antwort.
2. Zusagen in einem Tipp; Mitfahrten sind Teil der Zusage, kein eigenes System.
3. Mitgliederdaten bleiben im Kreis: nur so viel zeigen, wie Mitglieder untereinander brauchen.
4. Lokal und persönlich statt Vereinsportal: Namen statt Nummern.

## Accessibility & Inclusion

WCAG 2.2 AA als Ziel: Tastaturbedienung, sichtbarer Fokus, 44px-Zielflächen, reduzierte Bewegung respektieren, Inhalte ohne JavaScript-Animation sichtbar.
