# Oberfläche der Bottwartal Borussen

Die vier Skills `frontend-design`, `make-interfaces-feel-better`, `no-ai-slop` und `humanizer` wurden für Gestaltung, Bedienung und Texte angewendet.

## Gestaltungsentscheidungen

- Farben: Fanclub-Gelb `#ffe500`, Schwarz `#000000`, Weiß `#ffffff`, helle Inhaltsfläche `#f7f7f2`, Textgrau `#54564f`.
- Schrift: vorhandenes Anton für die plakativen Überschriften, Inter für Navigation und Lesetext. Fließtext mit höchstens etwa 62 Zeichen pro Zeile.
- Aufbau: linksbündiger Titel und Einführung, rechts Vereinszeichen und Spielanzeige. Auf Mobilgeräten folgen die Inhalte untereinander.
- Schwerpunkt: Der Vereinsname auf Gelb bildet das zentrale Motiv. Die übrigen Bereiche unterstützen Orientierung und Lesbarkeit.

```text
Desktop                         Mobil
Navigation                      Marke + Menü
Titel        Vereinszeichen     Titel + Einführung
Einführung   Spielanzeige        Aktionen
Aktionen                        Vereinszeichen + Spielanzeige
Fanclub                         Fanclub
Mitgliedertermine               Mitgliedertermine
Meldungen                       Meldungen
Kontakt                         Kontakt
```

Eine weitere dekorative Stadiongrafik wurde verworfen: Das vorhandene Vereinszeichen vermittelt die Identität bereits. Die bestehende Schwarzgelb-Palette und Schriftwahl bleiben erhalten, da sie zum Fanclub passen. Die bewegte Schlagwortleiste wurde durch zwei ruhige Zeilen ersetzt. Eine zusätzliche Schrift oder Animationsbibliothek war nicht erforderlich.

## Prüfung der Oberfläche

Modus: full. Technik: statisches HTML, JavaScript, vorhandenes CSS ergänzt durch `design.css`. Betrachtet wurden die öffentliche Startseite, Login und öffentliche Informationsseiten. Geschützte Mitglieder- und Verwaltungsansichten wurden nur im Quelltext geprüft; keine Anmeldung mit echten Zugangsdaten.

| Kategorie | Betrachtet | Ergebnis |
| --- | --- | --- |
| Typografie | Überschriften, Lesetexte, Spielanzeige, Login | Hierarchie, Zeilenlänge und Ziffernausrichtung verbessert |
| Flächen | Hero, Termine, Meldungen, Login | Lesbare Trennung, gezielte Rundungen, reduzierte Schatten |
| Bewegung | bisherige Reveal-, Logo- und Ticker-Effekte; Menü | Automatische Bewegungen entfernt; Reduced Motion geprüft |
| Icons | Login-Symbol und Menütaste | Vorhandenes SVG mit currentColor, einheitliche Strichstärke, 44px-Zielflächen |
| Performance | CSS-Übergänge, Abhängigkeiten, externe Spieldaten | Explizite Übergänge; keine neue Projektabhängigkeit; Spielabfrage mit Zeitlimit |

| Schwere | Datei / Bereich | Vorher | Nachher | Grund |
| --- | --- | --- | --- | --- |
| Mittel | index.html, design.css / Einstieg | Leuchtende Überschrift über dekorativem Hintergrund | Schwarzer Vereinsname auf Gelb, separate Spielanzeige | Klarere Hierarchie und Lesbarkeit |
| Mittel | design.css / Inhaltsbereiche | Fast durchgehend dunkle Flächen und schwere Schrift | Helle Fanclub- und Terminbereiche, ruhigere Lesetexte | Unterscheidbare Bereiche und lesbarer Text |
| Mittel | index.html, script.js / mobiles Menü | Kein mitgeteilter Öffnungszustand, kein Escape | aria-expanded, aria-controls, Escape und Rückgabe des Fokus | Bedienung mit Tastatur und assistiven Technologien |
| Mittel | index.html, design.css / Orientierung | Kein Sprunglink; kleine mobile Menütaste | Sprunglink, sichtbarer Fokus, 44px-Menütaste, Scroll-Abstand | Zugängliche Navigation |
| Mittel | script.js, design.css / Bewegung | Verdeckter Text ohne JavaScript, wiederholte Bewegung | Inhalte sofort sichtbar, ruhige Flächen, Reduced Motion | Informationen bleiben verfügbar |
| Niedrig | design.css / Bedienelemente | Pillenform und schwebender Hover-Effekt | Abgestufte Radien, Farbzustände und dezente Druckrückmeldung | Verständliche interaktive Zustände |
| Niedrig | design.css / Spielanzeige | Schwere Labels, variable Ziffernbreiten | Ruhigere Labels, tabellarische Ziffern, klare Zeilen | Besser vergleichbare Angaben |
| Mittel | script.js / Spielabfrage | Netzwerkfehler wurden wie leere Spielpläne behandelt | Eigene Fehlermeldung und 8-Sekunden-Zeitlimit | Korrekte Erklärung fehlender Daten |
| Niedrig | index.html, login.html, members.html / Texte | Allgemeine Werbesprache, uneinheitliche englische Begriffe | Direkte deutsche Texte und konkrete Aktionen | Verständliche Orientierung |
| Mittel | login.html, design.css / Formulare | Zwei Hauptüberschriften, Status ohne Live-Region | Eine Hauptüberschrift, Status mit role=status, klare Formularfläche | Semantik und Rückmeldung |
| Mittel | design.css / geschützte Aktionen | display-Regeln konnten hidden übersteuern | Explizite hidden-Regel | Verborgene Elemente bleiben verborgen |

Alle sechs HTML-Seiten binden `design.css` ein. Die Inhalte von Impressum und Datenschutz wurden nicht bearbeitet. Bestehende Datenattribute für administrierbare Texte bleiben erhalten; gespeicherte Inhalte können weiterhin die statischen Standardtexte ersetzen.

## Ausgeführte Prüfungen

- `node --check script.js`: erfolgreich.
- Lokaler Server: `PORT=3109 node server.js`.
- Playwright-Prüfung `/tmp/bvb-design-check.cjs`: Startseite mit 1440, 1024, 768, 390 und 320px; kein horizontaler Überlauf. Mobiles Menü öffnet, schließt per Escape und nach Linkauswahl.
- Login, Impressum und Datenschutz jeweils bei 1440, 390 und 320px: kein horizontaler Überlauf. Keine JavaScript-Laufzeitfehler in diesen Prüfungen.
- Screenshots der Startseite auf Desktop und Mobil sowie des Desktop-Logins visuell geprüft. Kontrast des sekundären Kontaktbuttons anschließend korrigiert.
- Playwright-Prüfung `/tmp/bvb-states-check.cjs`: leere Spielantwort, Netzwerkausfall, Tastatur-Sprunglink, Reduced Motion, Pflichtfelder beim Login, eine Login-Hauptüberschrift und sichtbare Inhalte ohne JavaScript erfolgreich geprüft.
- Lokale Ressourcenverweise aller sechs HTML-Seiten vorhanden.
- Textprüfung nach `no-ai-slop/eval.md`: direkte Aussagen, konsistente Begriffe, keine neu erfundenen Termine oder Vereinszahlen. Humanizer im Dateimodus für die sichtbaren Texte angewendet.

Nicht geprüft: erfolgreiche Anmeldung, geschützte Mitglieder-/Adminabläufe, Screenreader-Ausgabe und Übergänge bei 10% Geschwindigkeit. Die verbleibenden Übergänge betreffen nur Bedienzustände; keine automatischen Logo-, Ticker- oder Reveal-Animationen auf der Startseite. Git konnte für die Veröffentlichung mit `DEVELOPER_DIR=/Library/Developer/CommandLineTools` verwendet werden; der ursprüngliche Xcode-Lizenzfehler betrifft diesen Aufruf nicht.

Bewertung: Die geprüften öffentlichen Ansichten haben keine verbleibenden konkreten Befunde. Eine vollständige Freigabe der geschützten Ansichten steht bis zur Prüfung mit einem Mitgliedskonto aus.
