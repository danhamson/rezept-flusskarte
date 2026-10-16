/* Flusskarte – Umwandlung mit einer beliebigen KI über die Zwischenablage.
 * Die App ruft selbst keine KI auf. Sie liefert einen Prompt, der jede Chat-KI das Format
 * „flusskarte/1“ lehrt, und liest deren Antwort wieder ein (auch mit Codeblock und Begleittext).
 * Die KI schreibt das Rezept außerdem in einer Standardform neu ("source"); dieser Text ersetzt
 * das Eingabefeld und ist so gegliedert, dass auch der lokale Parser ihn gut lesen kann.
 */
(function (FK) {
  "use strict";

  const FORMAT = `Du wandelst Kochrezepte in eine „Flusskarte“ um (Format „flusskarte/1“): einen Graphen aus Zutaten, Geräten und Arbeitsschritten für eine tabellarische Rezeptkarte. Jede Zutat fließt in Schritte, jeder Schritt erzeugt ein Zwischenprodukt, das in einen späteren Schritt fließt, bis zum fertigen Gericht. Außerdem schreibst du das Rezept in einer einheitlichen Standardform neu.

Antworte nur mit einem JSON-Objekt in einem Codeblock, ohne Erklärungen davor oder danach. Form:
{
  "format": "flusskarte/1",
  "title": string,
  "servings": number | null,
  "statedTime": string,
  "source": string,
  "ingredients": [{"id": "z1", "qty": {"min": number, "max": number} | null, "unit": string, "name": string, "note": string, "optional": boolean, "missing": boolean}],
  "equipment": [{"id": "g1", "name": string, "note": string}],
  "steps": [{"id": "s1", "verb": string, "detail": string, "inputs": [{"ref": string, "portion": string}], "dur": {"min": number, "max": number} | null, "temp": string, "passive": boolean, "repeat": string, "cue": string, "note": string, "product": string, "src": string}],
  "lint": [string]
}

Regeln:
1. Behalte die Sprache des Rezepts bei. Mengen als Zahlen (½ = 0.5, „2-3“ = min 2, max 3), Einheit wie geschrieben. Portionenzahl und Zeitangabe aus Titel oder Überschriften übernehmen.
2. Jede Zutat der Liste wird ein Eintrag; „Salz, Pfeffer“ sind zwei Zutaten. Verwendet die Zubereitung eine Zutat, die in der Liste fehlt, lege sie mit "missing": true und qty null an.
3. Geräte nur aufnehmen, wenn sie selbst vorbereitet werden (Ofen vorheizen, Form ausfetten, Pfanne erhitzen). Werkzeuge wie Messer, Hobel oder Alufolie gehören in "detail".
4. Ein Schritt ist genau eine Handlung mit einem kurzen Verb im Infinitiv (z. B. „hobeln“, „verrühren“, „backen“). "detail" hat höchstens fünf Wörter (Größe, Form, Hitze, abgedeckt).
5. "inputs" verweisen auf Zutaten-, Geräte- oder frühere Schritt-IDs. Das Ergebnis jedes Schritts wird von genau einem späteren Schritt verwendet, nur das des letzten Schritts nicht. Wird eine Zutat an mehreren Stellen verwendet, bekommt jede Verwendung einen eigenen Eingang mit "portion" (z. B. „etwas“, „⅔“, „Rest“, „1 Zehe“). Jede Zutat der Liste kommt mindestens einmal vor.
6. Ordne die Schritte in sinnvoller Arbeitsreihenfolge. Unabhängige Vorbereitungen sind eigene Stränge und werden erst dort zusammengeführt, wo sie wirklich zusammenkommen.
7. "dur" in Minuten nur, wenn das Rezept eine Zeit nennt, sonst null. "temp" wie „180 °C“ oder „mittlere Hitze“, sonst "". "passive": true bei Wartezeit ohne Handgriffe (vorheizen, backen, kochen, köcheln, ruhen, kühlen).
8. "repeat" z. B. „3–4“, wenn ein Schritt wiederholt wird, sonst "". "cue": woran man erkennt, dass der Schritt fertig ist. "note": Begründung oder Tipp aus dem Rezept.
9. "product": Name des Zwischenprodukts, wenn das Rezept einen nennt (z. B. „Zwiebelringe“, „Sahne-Milch-Mischung“), sonst "".
10. "src": das kürzeste wörtliche Zitat aus "source" (nicht aus dem eingeschickten Text), aus dem der Schritt stammt, Zeichen für Zeichen kopiert.
11. "lint": Unstimmigkeiten im Originalrezept, je ein kurzer Satz (z. B. eine Zutat wird zweimal verwendet, aber nur einmal mit Menge gelistet). Leer, wenn alles stimmt.

Rezepttext in Standardform ("source", Zeilen mit \\n getrennt, in der Sprache des Rezepts):
"""
<Titel> (<Anzahl> Portionen)

Zutaten

* <Menge> <Einheit> <Zutat>, <Zusatz>

Zubereitung (<Zeitangabe>)

1. <Arbeitsgang>
Tipp: <Hinweis zu diesem Arbeitsgang>
2. <Arbeitsgang>
"""
A. Der Inhalt bleibt der des Rezepts: keine Zutat, Menge, Zeit, Temperatur, Garprobe oder Begründung erfinden, ändern oder weglassen. Weg fallen nur Einleitung, Geschichten, Werbung, Bildunterschriften, Bewertungen, Nährwerte und Hinweise wie „Rezept drucken“. Eine Zutat, die in der Liste fehlt, bleibt auch hier ungelistet.
B. Titel ohne Zusätze wie „Rezept:“ oder Werbesprüche. „(… Portionen)“ nur, wenn das Rezept eine Anzahl nennt, „(…)“ hinter „Zubereitung“ nur mit genannter Zeitangabe.
C. Jede Zutat eine eigene Zeile mit „* “: Menge in Ziffern (½, ¼, ¾ oder Dezimalkomma, Spannen als „2-3“), Einheit abgekürzt (g, kg, ml, l, EL, TL, Prise, Bund, Dose …), dann die Zutat. Zusätze wie „fein gerieben“ oder „für die Form“ nach einem Komma. Optionale Zutaten beginnen mit „Optional: “. Unterteilt das Rezept die Zutaten (z. B. „Für den Teig:“), bleiben diese Zwischenzeilen erhalten.
D. Die Zubereitung als nummerierte Arbeitsgänge in der Reihenfolge des Rezepts, je Arbeitsgang ein Absatz mit einem oder mehreren kurzen Sätzen. Kochbuchstil mit dem Verb im Infinitiv am Satzende („Zwiebeln in feine Ringe schneiden.“), keine Du- oder Sie-Form. Zeiten als „5-10 Min.“ oder „1 Std.“, Temperaturen als „180 °C“, Garpunkte mit „bis …“.
E. Tipps und Begründungen, die keine eigene Handlung sind, stehen in einer eigenen Zeile „Tipp: …“ direkt unter dem Arbeitsgang, zu dem sie gehören.
F. Englische Rezepte: dieselbe Gliederung mit „(… servings)“, „Ingredients“, „Instructions“ und „Tip: …“, Verben im Imperativ am Satzanfang.

Beispiel. Rezept:
"""
Omas Rührei – geht super schnell! Reicht für 2 Personen.
Du brauchst: 4 Eier, 2 EL Milch, Salz, 1 TL Butter
Verquirle die Eier mit der Milch und Salz. Lass die Butter in einer Pfanne schmelzen. Gib die Eiermasse hinein und lass sie bei mittlerer Hitze 3-4 Minuten stocken, bis sie cremig ist. Nicht zu viel rühren, dann bleibt es saftig.
"""
Antwort:
\`\`\`json
{"format":"flusskarte/1","title":"Omas Rührei","servings":2,"statedTime":"",
"source":"Omas Rührei (2 Portionen)\\n\\nZutaten\\n\\n* 4 Eier\\n* 2 EL Milch\\n* Salz\\n* 1 TL Butter\\n\\nZubereitung\\n\\n1. Eier mit Milch und Salz verquirlen.\\n2. Butter in einer Pfanne schmelzen.\\n3. Eiermasse hineingeben und bei mittlerer Hitze 3-4 Min. stocken lassen, bis sie cremig ist.\\nTipp: Nicht zu viel rühren, dann bleibt es saftig.",
"ingredients":[{"id":"z1","qty":{"min":4,"max":4},"unit":"","name":"Eier","note":"","optional":false,"missing":false},{"id":"z2","qty":{"min":2,"max":2},"unit":"EL","name":"Milch","note":"","optional":false,"missing":false},{"id":"z3","qty":null,"unit":"","name":"Salz","note":"","optional":false,"missing":false},{"id":"z4","qty":{"min":1,"max":1},"unit":"TL","name":"Butter","note":"","optional":false,"missing":false}],
"equipment":[{"id":"g1","name":"Pfanne","note":""}],
"steps":[{"id":"s1","verb":"verquirlen","detail":"","inputs":[{"ref":"z1","portion":""},{"ref":"z2","portion":""},{"ref":"z3","portion":""}],"dur":null,"temp":"","passive":false,"repeat":"","cue":"","note":"","product":"Eiermasse","src":"Eier mit Milch und Salz verquirlen"},
{"id":"s2","verb":"schmelzen","detail":"","inputs":[{"ref":"g1","portion":""},{"ref":"z4","portion":""}],"dur":null,"temp":"","passive":false,"repeat":"","cue":"","note":"","product":"","src":"Butter in einer Pfanne schmelzen"},
{"id":"s3","verb":"stocken lassen","detail":"","inputs":[{"ref":"s2","portion":""},{"ref":"s1","portion":""}],"dur":{"min":3,"max":4},"temp":"mittlere Hitze","passive":false,"repeat":"","cue":"cremig","note":"Nicht zu viel rühren, dann bleibt es saftig","product":"","src":"bei mittlerer Hitze 3-4 Min. stocken lassen, bis sie cremig ist"}],
"lint":[]}
\`\`\``;

  const GENERIC = FORMAT + `

Ich schicke dir gleich ein oder mehrere Rezepte. Antworte auf jedes nur mit der Flusskarte als JSON-Codeblock nach diesen Regeln.`;

  function promptFor(text) {
    return FORMAT + `

Wandle jetzt dieses Rezept um:
"""
${String(text || "").slice(0, 60000)}
"""`;
  }

  /** Antwort der KI → Rohobjekt. Nimmt Codeblöcke, Begleittext und kleine Formfehler hin. */
  function extract(answer) {
    const text = String(answer || "").trim();
    if (!text) throw new Error("Bitte zuerst die Antwort der KI einfügen.");
    const candidates = [];
    const fence = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/g;
    let f;
    while ((f = fence.exec(text))) if (f[1].includes("{")) candidates.push(f[1]);
    candidates.sort((a, b) => b.length - a.length);
    candidates.push(text);
    let lastErr = null;
    for (const c of candidates) {
      const a = c.indexOf("{"), b = c.lastIndexOf("}");
      if (a < 0 || b <= a) continue;
      const body = c.slice(a, b + 1);
      for (const variant of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
        try {
          const raw = JSON.parse(variant);
          if (raw && typeof raw === "object" && (Array.isArray(raw.steps) || Array.isArray(raw.ingredients))) return raw;
          lastErr = new Error("Das JSON enthält keine Zutaten oder Schritte.");
        } catch (e) { lastErr = lastErr || e; }
      }
    }
    throw new Error(lastErr ? "Die Antwort enthält kein lesbares Flusskarten-JSON (" + lastErr.message + ")." : "In der Antwort steht kein JSON-Objekt.");
  }

  /** Zitat im Text finden; Leerraum, Groß- und Kleinschreibung und Strichvarianten dürfen abweichen. */
  function locate(text, quote) {
    const i = text.indexOf(quote);
    if (i >= 0) return [i, i + quote.length];
    const words = quote.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const pat = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-–—]/g, "[-–—]")).join("\\s+");
    const hit = new RegExp(pat, "i").exec(text);
    return hit ? [hit.index, hit.index + hit[0].length] : null;
  }

  /** Originaltext anhängen und Zitate der Schritte darin verorten. */
  function attachSource(m, text) {
    if (!m.source) m.source = text || "";
    for (const s of m.steps) {
      if (s.src && !s.srcRange) s.srcRange = locate(m.source, s.src);
    }
    return m;
  }

  FK.ai = { GENERIC, promptFor, extract, attachSource };
})(window.FK = window.FK || {});
