---
version: 1
slug: "members-html"
primary_target: "members.html"
related_targets: ["members.js"]
---

# Mitgliederbereich (members.html)

Mode: Operate. Mitglieder auf dem Handy kurz vor Treffen und Spieltagen.
Task: nächstes Spiel und nächsten Termin sehen, zu-/absagen, Mitfahrt absprechen, Meldungen lesen, Mitglieder finden, Profil pflegen.
States: laden (Skeleton), leer (keine Termine), Fehler (Server/Supabase weg), gespeichert, nicht eingeloggt.

## Direction contract

THESIS: Ein Spieltags-Cockpit des eigenen Fanclubs statt Vereinsportal-Kacheln: oben die Anzeigetafel zum nächsten Spiel, darunter „Dein nächster Termin" mit der eigenen Antwort in einem Tipp. Verweigert das Dashboard aus gleich großen Karten.
OWN-WORLD: schwarze Shell (Kopf, Tab-Leiste), Gelb als Zustand und Auswahl (gewählte Antwort, aktive Ansicht, Zähler), dunkle Arbeitsflächen #141412, Anton nur für Ansichtstitel und Ziffern der Anzeigetafel, Inter für alles Bedienbare.
STORY: Mitglied öffnet, sieht in Sekunden was ansteht und ob es schon geantwortet hat, antwortet, sieht wer mitfährt.
FIRST VIEWPORT: Mobil: Kopf mit Logo; Begrüßung; Anzeigetafel (Teams, Datum, laufender Countdown T/S/M/S); Karte nächster Termin mit Segment-Schaltern Dabei/Vielleicht/Nein; feste untere Tab-Leiste Spieltag/Termine/Mitglieder/Profil. Desktop: Tabs oben im Kopf, zweispaltig (Tafel+Termin links, Meldungen+Tippspiel rechts).
FORM: Signature move: Anzeigetafel mit rollenden Ziffern (geteilt mit der Startseite); zweite Note: digitaler Fanclub-Ausweis im Profil. seed: none (pinned) – „Schwarzgelb, Logo und Anton-Schrift bleiben … Spieltags-Countdown als Erlebnis und dezente Bewegung".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
