# Rezept-Flusskarte

Web-Editor, der ein normal geschriebenes Rezept in eine tabellarische **Flusskarte** umwandelt und Original und Karte nebeneinander zeigt.

## Starten

- Doppelklick auf `index.html` genügt (keine Abhängigkeiten, kein Build für den Betrieb).
- Oder mit lokalem Server: `node tools/serve.mjs` → http://localhost:5178
- Als claude.ai-Artefakt kommt „Mit Claude umwandeln“ hinzu (Fähigkeit `sample`), dazu Speichern über `downloads`.

## Ansichten

| Ansicht | Inhalt |
|---|---|
| Flusskarte | Karte: Menge, Zutat, Geräte, Arbeitsschritte mit Zeit, Hitze, Wartezeit, Garpunkt, Zwischenprodukt |
| Zeitplan | Ablauf für eine Person: aktive Schritte nacheinander, Wartezeiten parallel, längster Weg zuerst |
| Original | Eingabetext mit markierten Zutaten; Sätze sind mit ihren Schritten verknüpft |
| JSON | Datenmodell zum Kopieren, Bearbeiten, Laden |

Links lässt sich der Text bearbeiten (die Karte folgt live) oder die Struktur direkt: Zutaten, Geräte, Schritte mit Eingängen und Anteilen. Ein Klick auf einen Schritt in der Karte öffnet ihn im Editor.

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

`inputs[].ref` zeigt auf eine Zutat, ein Gerät oder einen früheren Schritt. Ein Schritt ohne Verbraucher ist das fertige Gericht.

## Aufbau

```
page.html          Seiteninhalt (Quelle; Artefakt)
index.html         aus page.html erzeugt: node tools/build.mjs
styles.css
js/lexicon.js      Verben (mit Klassen), Einheiten, Geräte, Mengenwörter
js/model.js        Mengen, Normalisierung, Prüfung, Namen von Zwischenprodukten
js/parser.js       Text → Graph (regelbasiert, Deutsch, etwas Englisch)
js/layout.js       Graph → Tabellenraster (rowspan/colspan, Füllzellen)
js/schedule.js     Zeitplan für eine Person
js/render.js       HTML aller Ansichten, Export als eigenständiges HTML
js/claude.js       Umwandlung mit Claude im Artefakt
js/app.js          Oberfläche, Editor, Speichern
tools/check.mjs    Parser, Layout und Zeitplan ohne Browser prüfen
tools/serve.mjs    statischer Vorschau-Server
samples/           Beispielrezepte
```

## Grenzen des lokalen Parsers

Der regelbasierte Parser erkennt Verben aus einer Liste (Infinitiv am Satzende, englisch am Satzanfang), verfolgt, in welchem Zwischenprodukt eine Zutat steckt, und setzt Handlungen ohne eigenes Material am aktuellen Gericht fort. Frei formulierte Rezepte, Pronomen ohne Bezug oder ungewöhnliche Verben brauchen „Mit Claude umwandeln“ oder Nacharbeit im Struktur-Editor. Geschätzte Dauern im Zeitplan sind als solche markiert.
