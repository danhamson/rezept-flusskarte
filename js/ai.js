/* Flusskarte – Umwandlung mit einer beliebigen KI über die Zwischenablage.
 * Die App ruft selbst keine KI auf. Sie liefert einen Prompt, der jede Chat-KI das Format
 * „flusskarte/1“ lehrt, und liest deren Antwort wieder ein (auch mit Codeblock und Begleittext).
 */
(function (FK) {
  "use strict";

  const FORMAT = `Du wandelst Kochrezepte in eine „Flusskarte“ um (Format „flusskarte/1“): einen Graphen aus Zutaten, Geräten und Arbeitsschritten für eine tabellarische Rezeptkarte. Jede Zutat fließt in Schritte, jeder Schritt erzeugt ein Zwischenprodukt, das in einen späteren Schritt fließt, bis zum fertigen Gericht.

Antworte nur mit einem JSON-Objekt in einem Codeblock, ohne Erklärungen davor oder danach. Form:
{
  "format": "flusskarte/1",
  "title": string,
  "servings": number | null,
  "statedTime": string,
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
7. "dur" in Minuten nur, wenn das Rezept eine Zeit nennt, sonst null. "temp" wie „180 °C“ oder „mittlere Hitze“, sonst "". "passive": true bei Wartezeit ohne Handgriffe (vorheizen, backen, ruhen, kühlen).
8. "repeat" z. B. „3–4“, wenn ein Schritt wiederholt wird, sonst "". "cue": woran man erkennt, dass der Schritt fertig ist. "note": Begründung oder Tipp aus dem Rezept.
9. "product": Name des Zwischenprodukts, wenn das Rezept einen nennt (z. B. „Zwiebelringe“, „Sahne-Milch-Mischung“), sonst "".
10. "src": das kürzeste wörtliche Zitat aus dem Rezepttext, aus dem der Schritt stammt, exakt kopiert.
11. "lint": Unstimmigkeiten im Originalrezept, je ein kurzer Satz (z. B. eine Zutat wird zweimal verwendet, aber nur einmal mit Menge gelistet). Leer, wenn alles stimmt.

Beispiel. Rezept:
"""
Rührei (2 Portionen)
4 Eier, 2 EL Milch, Salz, 1 TL Butter
1. Eier mit Milch und Salz verquirlen.
2. Butter in einer Pfanne schmelzen.
3. Eiermasse hineingeben und bei mittlerer Hitze 3-4 Min. stocken lassen, bis sie cremig ist.
"""
Antwort:
\`\`\`json
{"format":"flusskarte/1","title":"Rührei","servings":2,"statedTime":"",
"ingredients":[{"id":"z1","qty":{"min":4,"max":4},"unit":"","name":"Eier","note":"","optional":false,"missing":false},{"id":"z2","qty":{"min":2,"max":2},"unit":"EL","name":"Milch","note":"","optional":false,"missing":false},{"id":"z3","qty":null,"unit":"","name":"Salz","note":"","optional":false,"missing":false},{"id":"z4","qty":{"min":1,"max":1},"unit":"TL","name":"Butter","note":"","optional":false,"missing":false}],
"equipment":[{"id":"g1","name":"Pfanne","note":""}],
"steps":[{"id":"s1","verb":"verquirlen","detail":"","inputs":[{"ref":"z1","portion":""},{"ref":"z2","portion":""},{"ref":"z3","portion":""}],"dur":null,"temp":"","passive":false,"repeat":"","cue":"","note":"","product":"Eiermasse","src":"Eier mit Milch und Salz verquirlen"},
{"id":"s2","verb":"schmelzen","detail":"","inputs":[{"ref":"g1","portion":""},{"ref":"z4","portion":""}],"dur":null,"temp":"","passive":false,"repeat":"","cue":"","note":"","product":"","src":"Butter in einer Pfanne schmelzen"},
{"id":"s3","verb":"stocken lassen","detail":"","inputs":[{"ref":"s2","portion":""},{"ref":"s1","portion":""}],"dur":{"min":3,"max":4},"temp":"mittlere Hitze","passive":false,"repeat":"","cue":"cremig","note":"","product":"","src":"bei mittlerer Hitze 3-4 Min. stocken lassen, bis sie cremig ist"}],
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

  /** Originaltext anhängen und Zitate der Schritte darin verorten. */
  function attachSource(m, text) {
    if (!m.source) m.source = text || "";
    for (const s of m.steps) {
      if (s.src && !s.srcRange) { const i = m.source.indexOf(s.src); s.srcRange = i >= 0 ? [i, i + s.src.length] : null; }
    }
    return m;
  }

  FK.ai = { GENERIC, promptFor, extract, attachSource };
})(window.FK = window.FK || {});
