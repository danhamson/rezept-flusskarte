/* Flusskarte – Umwandlung mit Claude (Artefakt-Fähigkeit „sample“).
 * Läuft nur im claude.ai-Artefakt; lokal fehlt window.claude und der Knopf bleibt verborgen.
 */
(function (FK) {
  "use strict";

  const PROMPT = `Du wandelst ein Kochrezept in eine „Flusskarte“ um: einen Graphen aus Zutaten, Geräten und Arbeitsschritten für eine tabellarische Rezeptkarte. Jede Zutat fließt in Schritte, jeder Schritt erzeugt ein Zwischenprodukt, das in einen späteren Schritt fließt, bis zum fertigen Gericht.

Antworte nur mit einem JSON-Objekt in genau dieser Form:
{
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
3. Geräte nur aufnehmen, wenn sie selbst vorbereitet werden (Ofen vorheizen, Form ausfetten). Werkzeuge wie Messer, Hobel oder Alufolie gehören in "detail".
4. Ein Schritt ist genau eine Handlung mit einem kurzen Verb im Infinitiv (z. B. „hobeln“, „verrühren“, „backen“). "detail" hat höchstens fünf Wörter (Größe, Form, Hitze, abgedeckt).
5. "inputs" verweisen auf Zutaten-, Geräte- oder frühere Schritt-IDs. Das Ergebnis jedes Schritts wird von genau einem späteren Schritt verwendet, nur das des letzten Schritts nicht. Wird eine Zutat an mehreren Stellen verwendet, bekommt jede Verwendung einen eigenen Eingang mit "portion" (z. B. „etwas“, „⅔“, „Rest“, „1 Zehe“). Jede Zutat der Liste kommt mindestens einmal vor.
6. Ordne die Schritte in sinnvoller Arbeitsreihenfolge. Unabhängige Vorbereitungen sind eigene Stränge und werden erst dort zusammengeführt, wo sie wirklich zusammenkommen.
7. "dur" in Minuten nur, wenn das Rezept eine Zeit nennt, sonst null. "temp" wie „180 °C“ oder "". "passive": true bei Wartezeit ohne Handgriffe (vorheizen, backen, ruhen, kühlen).
8. "repeat" z. B. „3–4“, wenn ein Schritt wiederholt wird, sonst "". "cue": woran man erkennt, dass der Schritt fertig ist. "note": Begründung oder Tipp aus dem Rezept.
9. "product": Name des Zwischenprodukts, wenn das Rezept einen nennt (z. B. „Zwiebelringe“, „Sahne-Milch-Mischung“), sonst "".
10. "src": das kürzeste wörtliche Zitat aus dem Rezepttext, aus dem der Schritt stammt, exakt kopiert.
11. "lint": Unstimmigkeiten im Originalrezept, je ein kurzer Satz (z. B. eine Zutat wird zweimal verwendet, aber nur einmal mit Menge gelistet). Leer, wenn alles stimmt.

Rezept:
"""
{{RECIPE}}
"""`;

  const ERRORS = {
    not_granted: "Claude ist für diese Seite nicht freigegeben.",
    sampling_disabled: "Claude ist für dieses Konto nicht verfügbar.",
    not_declared: "Claude ist in dieser Ansicht nicht verfügbar.",
    capability_disabled: "Claude ist in dieser Ansicht nicht verfügbar.",
    capability_removed: "Claude ist in dieser Ansicht nicht verfügbar.",
    rate_limited: "Gerade zu viele Anfragen. Bitte später erneut versuchen.",
    session_expired: "Die Sitzung ist abgelaufen. Bitte neu anmelden.",
    refused: "Claude hat dieses Rezept nicht umgewandelt. Bitte den Text prüfen.",
    invalid_json: "Die Antwort war keine gültige Karte. Bitte erneut versuchen.",
    prompt_too_large: "Das Rezept ist zu lang. Bitte kürzen.",
    empty_completion: "Claude hat nichts geliefert. Bitte den Text vereinfachen.",
    cancelled: "Abgebrochen."
  };
  const HIDE = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);

  async function convert(sample, text, { signal, onProgress }) {
    const prompt = PROMPT.replace("{{RECIPE}}", text.slice(0, 60000));
    const raw = await sample.json(prompt, {
      signal, modelTier: "default",
      onText: ({ text: t }) => onProgress && onProgress(t.length)
    });
    const m = FK.model.normalize(raw);
    m.source = text;
    for (const s of m.steps) {
      if (s.src) { const i = text.indexOf(s.src); s.srcRange = i >= 0 ? [i, i + s.src.length] : null; }
    }
    for (const l of m.lint) l.origin = "claude";
    return m;
  }

  function errorText(e) {
    const code = e && e.code;
    return { text: ERRORS[code] || "Die Verbindung wurde unterbrochen. Bitte erneut versuchen.", hide: HIDE.has(code), cancelled: code === "cancelled" };
  }

  FK.claude = { convert, errorText };
})(window.FK = window.FK || {});
