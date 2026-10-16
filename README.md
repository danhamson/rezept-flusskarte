# Rezept-Flusskarte

Web-Editor, der ein normal geschriebenes Rezept in eine tabellarische **Flusskarte** umwandelt und Original und Karte nebeneinander zeigt.

## Starten

- Doppelklick auf `index.html` genügt (keine Abhängigkeiten, kein Build für den Betrieb).
- Oder mit lokalem Server: `node tools/serve.mjs` → http://localhost:5178
- Online über GitHub Pages: dort lässt sich die App auf Handy und iPad zum Home-Bildschirm hinzufügen und läuft nach dem ersten Aufruf auch offline.

## Funktionen

| Funktion | Wo | Wie |
|---|---|---|
| Mit KI umwandeln | Knopf unter dem Rezepttext | Die App ruft keine KI auf. Sie kopiert einen Prompt, der jede Chat-KI (ChatGPT, Gemini, Claude …) das Format `flusskarte/1` lehrt, wahlweise mit dem aktuellen Rezept oder als dauerhafte Formatanleitung. Die KI schreibt das Rezept dabei zusätzlich in einer Standardform neu (`source`: Titel mit Portionen, „Zutaten“ als `*`-Liste, „Zubereitung“ als nummerierte Schritte im Infinitiv, „Tipp:“-Zeilen; Inhalt unverändert, Einleitung und Nährwerte entfallen). Dieser Text ersetzt das Rezeptfeld, die Zitate der Schritte verweisen darauf, und auch „Umwandeln“ liest ihn gut. Die Antwort der KI wird eingefügt; Codeblöcke, Begleittext und überzählige Kommas stören nicht. |
| Teilen | Kopfzeile | Das Rezept als eine Zeile `FK1.…` (deflate-komprimiertes JSON, base64url), wahlweise mit Originaltext. Der Code lässt sich ins Rezeptfeld oder in „Code laden“ einfügen; online gibt es zusätzlich einen Link `…/#fk=FK1.…`. Umbrochene Codes aus Messengern werden wieder zusammengesetzt. |
| PDF | Kopfzeile | Eigene Druckseite (A4 quer oder hoch) mit Karte, Anmerkungen, Schichtplan, Zeitplan, Prüfung, Original. Die Karte wird auf Seitenbreite oder eine ganze Seite eingepasst; Schwarz-Weiß möglich. Ausgabe über den Druckdialog („Als PDF speichern“), daher scharfer, durchsuchbarer Text. |
| Darstellung | Kopfzeile, Symbol ◐ | Hell, Dunkel oder automatisch; 11 Farbschemata oder eigene Farben für Linien, Akzent und Hintergrund. Kontraste werden automatisch nachgeregelt. |
| Kochen | Flusskarte, Zeitplan | Einen Schritt antippen hakt ihn ab; die Zutaten davor werden grau. „Erledigtes ausblenden“ klappt fertige Äste zu einer Zeile „✓ #2 Auflaufform (ausgestrichen)“ ein. Ein erledigter Schritt, dessen Ergebnis ein offener Schritt noch braucht, bleibt sichtbar (die Spalte davor). Haken bleiben pro Browser gespeichert und überstehen Neuladen. Wurde 12 Stunden lang kein Haken gesetzt und läuft kein Timer, entfernt die App sie beim nächsten Öffnen von selbst (mit „Zurückholen“); „Zurücksetzen“ entfernt sie sofort. |
| Küchentimer | Zeitmarke im Schritt (Karte und Zeitplan) | Antippen startet einen Timer, nochmal antippen hält ihn an. Die Timer stehen unten rechts (auf dem Handy unten) mit Pause, +1 und +5 Minuten. Bei Spannen wie „35–40 min“ klingelt er nach der kürzeren Zeit. Alarm mit Ton, Vibration, ⏰ im Tab-Titel und einer Mitteilung, wenn der Tab im Hintergrund liegt und Mitteilungen erlaubt sind; „Aus + abhaken“ hakt den Schritt gleich ab. Die Endzeit wird gespeichert, ein Timer überlebt also Neuladen. Solange einer läuft, bleibt der Bildschirm an (Wake Lock). |
| Handy und iPad | – | Unter 960 px Breite schaltet ein Umschalter zwischen Rezept und Karte; die Karte lässt sich verkleinern oder einpassen. Größere Touch-Ziele, 16-px-Felder (kein Zoomen beim Antippen auf iOS), Dialoge als Blatt von unten, sichere Ränder für Notch und Home-Leiste. |

## Ansichten

| Ansicht | Inhalt |
|---|---|
| Flusskarte | Karte: Menge, Zutat, Geräte, Arbeitsschritte mit Zeit, Hitze, Wartezeit, Garpunkt, Zwischenprodukt |
| Zeitplan | Ablauf für eine Person: aktive Schritte nacheinander, Wartezeiten parallel, längster Weg zuerst |
| Original | Eingabetext mit markierten Zutaten; Sätze sind mit ihren Schritten verknüpft |
| JSON | Datenmodell zum Kopieren, Bearbeiten, Laden |

Links lässt sich der Text bearbeiten (die Karte folgt live) oder die Struktur direkt: Zutaten, Geräte, Schritte mit Eingängen und Anteilen. Ein Doppelklick auf einen Schritt in der Karte öffnet ihn im Editor (ein einfacher Klick hakt ab).

## Was die Flusskarte löst

| Problem | Lösung |
|---|---|
| Nur Bäume: eine Zutat an zwei Stellen muss doppelt notiert werden | Graph-Modell; jede Verwendung ist eine Zeile mit Anteil und Kennzeichnung „Teil 1/2“, Gesamtmenge bleibt sichtbar |
| Ofen vorheizen, Form vorbereiten fehlen | Geräte als eigene Zeilen; der Ofen läuft sichtbar parallel bis zum Backen |
| Keine Dauer, keine Wartezeiten | Dauer- und Temperatur-Marken, Wartezeiten schraffiert, eigener Zeitplan |
| Garpunkte („bis goldbraun“) gehen verloren | „✓ fertig, wenn …“ direkt im Schritt |
| Begründungen („nicht wässern – Stärke bindet“) fehlen | Fußnoten |
| Schichten brauchen ein Extra-Diagramm | Schichtplan wird aus dem Schritt erzeugt (Wiederholung ×3–4, obenauf, Boden) |
| Zwischenprodukte sind namenlos | „→ Zwiebelringe“, „→ Sahne-Milch-Mischung“ |
| Rezeptfehler bleiben unbemerkt | Prüfung: ungenutzte oder fehlende Zutaten, zu knappe Mengen, lose Enden, Kreise |
| Feste Mengen | Portionen umrechnen |

Im Beispiel (Kartoffelgratin) findet die Prüfung, dass die Butter nur „für die Form“ gelistet ist, aber auch für Butterflöckchen gebraucht wird.

## Datenformat `flusskarte/1`

```json
{
  "format": "flusskarte/1",
  "title": "…", "servings": 4, "statedTime": "ca. 20 Min. aktiv, 60-70 Min. Ofen",
  "ingredients": [{ "id": "z1", "qty": { "min": 1, "max": 1 }, "unit": "kg", "name": "Kartoffeln", "note": "vorwiegend festkochend", "optional": false, "missing": false }],
  "equipment":   [{ "id": "g1", "name": "Ofen", "note": "" }],
  "steps": [{
    "id": "s5", "verb": "hobeln", "detail": "2–3 mm dünne Scheiben",
    "inputs": [{ "ref": "s4", "portion": "" }],
    "dur": null, "temp": "", "passive": false, "repeat": "",
    "cue": "", "note": "Nicht wässern, die Stärke bindet die Soße", "product": "",
    "src": "in 2-3 mm dünne Scheiben hobeln"
  }]
}
```

`inputs[].ref` zeigt auf eine Zutat, ein Gerät oder einen früheren Schritt. Ein Schritt ohne Verbraucher ist das fertige Gericht. Das optionale Feld `source` enthält den Rezepttext (von der KI in Standardform); `src` ist ein wörtliches Zitat daraus.

## Aufbau

```
page.html          Seiteninhalt (Quelle; Artefakt)
index.html         aus page.html erzeugt: node tools/build.mjs (schreibt auch sw.js)
styles.css         Layout, Handy/Tablet, Dialoge, Druckseite
manifest.webmanifest, icons/, sw.js   Installierbar und offline (nur über https)
js/theme.js        Farbschemata, eigene Farben, Hell/Dunkel (lädt im <head>)
js/lexicon.js      Verben (mit Klassen), Einheiten, Geräte, Mengenwörter
js/model.js        Mengen, Normalisierung, Prüfung, Namen von Zwischenprodukten
js/parser.js       Text → Graph (regelbasiert, Deutsch, etwas Englisch)
js/layout.js       Graph → Tabellenraster (rowspan/colspan, Füllzellen)
js/schedule.js     Zeitplan für eine Person
js/kitchen.js      Küchentimer: Leiste, Alarm (Ton, Vibration, Mitteilung), Bildschirm an
js/render.js       HTML aller Ansichten, Export als eigenständiges HTML
js/share.js        Rezept-Code FK1.… kodieren, finden, entpacken
js/ai.js           Prompt für beliebige KI, Antwort einlesen
js/print.js        Druckseite für das PDF, Karte einpassen
js/app.js          Oberfläche, Editor, Dialoge, Speichern
tools/check.mjs    Regressionstests für Parser, Layout und Zeitplan; mit Datei: Umwandlung ausgeben
tools/serve.mjs    statischer Vorschau-Server
tools/icons.mjs    App-Icons erzeugen
samples/           Beispielrezepte
```

## Veröffentlichen (GitHub Pages)

Die Seite ist statisch; GitHub Pages liefert den Branch `main` aus dem Wurzelverzeichnis aus (`.nojekyll` liegt bei). Nach Änderungen an `page.html` oder den Skripten `node tools/build.mjs` ausführen, damit `index.html` und die Dateiliste des Service Workers stimmen, dann committen und pushen.

## Grenzen des lokalen Parsers

Der regelbasierte Parser erkennt Verben aus einer Liste: Infinitiv am Satzende, gebeugte du/er-Formen samt abgetrennter Partikel („dünstest … an“ → andünsten), englisch am Satzanfang. Von Rezeptseiten kopierter Text wird bereinigt: Kopfangaben (Zeiten, Portionen), Einleitung, Ankreuzkästchen vor Zutaten, Bildunterschriften zwischen den Absätzen und der Fuß ab „Nährwerte“ fallen weg, „TIPP:“-Absätze werden Fußnoten. Er verfolgt, in welchem Zwischenprodukt eine Zutat steckt, und setzt Handlungen ohne eigenes Material am aktuellen Gericht fort. Frei formulierte Rezepte, Pronomen ohne Bezug oder ungewöhnliche Verben brauchen „Mit KI umwandeln“ oder Nacharbeit im Struktur-Editor. Geschätzte Dauern im Zeitplan sind als solche markiert.
