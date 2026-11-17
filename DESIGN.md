---
name: Bottwartal Borussen
description: Gelbe Wand, schwarze Anzeigetafel – die Website des BVB-Fanclubs aus dem Bottwartal.
colors:
  yellow: "#ffe500"
  yellow-hover: "#fff15c"
  black: "#000000"
  ink: "#0b0b0a"
  panel: "#151513"
  panel-2: "#1f1f1b"
  line: "#2b2b26"
  line-strong: "#46463e"
  on-dark: "#f5f5ef"
  on-dark-muted: "#b4b4a7"
  paper: "#f2f2ef"
  white: "#ffffff"
  on-light: "#0b0b0a"
  on-light-muted: "#4c4d45"
  on-yellow-muted: "#3a3500"
  maybe: "#e6e6dc"
  no-bg: "#3d1c16"
  no-text: "#ffb4a5"
  alert: "#ff6a4d"
  error-text: "#ff9b8a"
typography:
  display:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(4.25rem, 10.4vw, 9.25rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(2.5rem, 5.2vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1
  view-title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "3rem"
    fontWeight: 400
    lineHeight: 1
  scoreboard-digits:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(2.4rem, 4.4vw, 3.4rem)"
    fontWeight: 400
    lineHeight: 1
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  lead:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  gutter: "max(20px, calc((100vw - 1240px) / 2))"
  section: "104px"
  panel: "24px"
  stack: "24px"
components:
  button-yellow:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.black}"
    rounded: "{rounded.sm}"
    height: "48px"
    padding: "0 22px"
  button-yellow-hover:
    backgroundColor: "{colors.yellow-hover}"
  button-black:
    backgroundColor: "{colors.black}"
    textColor: "{colors.yellow}"
    rounded: "{rounded.sm}"
    height: "48px"
  button-ghost-dark:
    textColor: "{colors.on-dark}"
    rounded: "{rounded.sm}"
    height: "44px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "24px"
  scoreboard:
    backgroundColor: "{colors.black}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "24px"
  term-date:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.black}"
    rounded: "{rounded.md}"
  segmented-yes:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.black}"
  segmented-maybe:
    backgroundColor: "{colors.maybe}"
    textColor: "{colors.black}"
  segmented-no:
    backgroundColor: "{colors.no-bg}"
    textColor: "{colors.no-text}"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.sm}"
    height: "50px"
---

## Overview

Zwei Register, eine Welt. Die öffentlichen Seiten sind Plakat: Gelb füllt ganze Abschnitte (die „gelbe Wand“), der Vereinsname steht in Anton in Übergröße, Schwarz ist die Gegenfläche. Der Mitgliederbereich ist Werkzeug: schwarze Shell, dunkle Arbeitsflächen, Gelb nur für Zustand und Auswahl. Das verbindende Element ist die **Anzeigetafel** – nächstes BVB-Spiel mit laufendem Countdown, Ziffern in Anton auf LED-Punktraster, die beim Wechsel einrollen. Zweites Erkennungszeichen im Mitgliederbereich: der digitale **Fanclub-Ausweis** im Profil.

Quellen: `app.css` (einziges Stylesheet), `scoreboard.js`, Logo `assets/fanclub-logo.jpeg`, Schriften selbst gehostet unter `assets/fonts/`.

## Colors

- **Gelb `#ffe500`** ist Fläche (Hero, „Mitglied werden“, Login-Wand, 404) und im Mitgliederbereich ausschließlich Zustand: aktive Ansicht, gewählte Zusage „Bin dabei“, Datumsmarke, eigene Person.
- **Schwarz / Ink** trägt Kopfzeilen, Anzeigetafel, Meldungen und den gesamten Mitgliederbereich.
- **Sekundärtext** wird aus dem Untergrund abgeleitet: `on-dark-muted` auf Dunkel, `on-light-muted` auf Hell, `on-yellow-muted` auf Gelb – nie neutrales Grau auf Gelb.
- **Zusagen** haben eine feste Farbsprache: dabei = Gelb, vielleicht = helles Grau (`maybe`), abgesagt = gedämpftes Rot (`no-bg`/`no-text`). `alert` nur für „braucht Aufmerksamkeit“ (Termin-Zähler, Fehlerhinweis).

## Typography

- **Anton** (selbst gehostet) nur für Plakat-Momente: Hero-Titel, Abschnittstitel, Ansichtstitel im Mitgliederbereich, Ziffern der Anzeigetafel und Datumsmarke, Name auf dem Ausweis. Immer Großbuchstaben.
- **Inter** (variabel, selbst gehostet) für alles Bedienbare und Lesbare. Panel-Überschriften im Mitgliederbereich sind Inter 700, nicht Anton.
- Zahlen in Datumsangaben, Zählern und Countdown sind `tabular-nums`.
- Lesetext max. 60–68 Zeichen pro Zeile.

## Layout

- Seitenrand `--gutter`: mindestens 20px, Inhalt max. 1240px.
- Öffentliche Abschnitte: 104px vertikal (72px mobil); Wechsel Gelb → Schwarz → Hell → Weiß → Schwarz → Gelb.
- Mitgliederbereich: Hash-Ansichten `#spieltag`, `#termine`, `#mitglieder`, `#profil`. Desktop: Tabs in der Kopfzeile, Spieltag zweispaltig (1.4 : 1). Mobil (≤760px): feste untere Tab-Leiste, einspaltig.

## Elevation & Depth

Eine Ebene je Element: dunkle Panels haben nur einen 1px-Rand (`line`), keinen Schatten. Schatten (`0 2px 4px / 0 24px 48px -16px`) nur für Elemente, die auf Gelb oder Weiß liegen (Anzeigetafel, Mitglieder-Kasten, Ausweis, Toast).

## Shapes

Radien 8 (Buttons, Eingaben), 12 (Datumsmarke, Segmente, Listenzeilen), 16 (Panels, Tafel, Ausweis). Pillen nur für kleine Status-Chips. Logo immer rund.

## Components

- **Anzeigetafel** (`[data-scoreboard]`, `scoreboard.js`): Daten von `/api/site/next-match`; Zustände loading / ready / empty / error / live. Nur die geänderte Ziffer rollt (420ms, ease-out, Blur). Pausiert bei verstecktem Tab.
- **Termin** (`.term`): gelbe Datumsmarke, „Heute/Morgen/In N Tagen“-Pill, Segment-Schalter Dabei/Vielleicht/Nein, optionaler Hinweis für Mitfahrten, Teilnahmebalken (Breiten per CSSOM wegen CSP), Personenliste mit Initialen-Avataren. Kompaktvariante auf der Spieltag-Ansicht.
- **Fanclub-Ausweis** (`.member-card`): Kartenformat 1.586:1, Name in Anton gelb, gelbe Faktenleiste; neigt sich mit der Maus (nur ohne reduzierte Bewegung).
- **Toast**: gelb, unten mittig (mobil über der Tab-Leiste), 2,8s.
- **Formulare**: Labels über dem Feld, 50px Höhe, 16px Schrift (kein iOS-Zoom), gelber Fokusring, Fehlermeldung unter dem Formular.

## Do's and Don'ts

- Do: Gelb als ganze Fläche oder als Zustand einsetzen, nie als Dekor-Streifen.
- Do: alle Ressourcen von der eigenen Domain laden (CSP `default-src 'self'`); keine Inline-Styles im HTML.
- Do: Bewegung nur für Zustandswechsel und die Anzeigetafel; `prefers-reduced-motion` respektieren.
- Don't: Kicker/Eyebrow-Zeilen über Überschriften, farbige Seitenränder an Karten, Verläufe in Schrift.
- Don't: Anton für Buttons, Labels oder Fließtext.
- Don't: Mitgliederzahlen, Fotos oder Erfolge erfinden.
