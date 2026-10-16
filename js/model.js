/* Flusskarte – Datenmodell, Mengen, Normalisierung und Konsistenzprüfung.
 *
 * Ein Rezept ist ein gerichteter Graph:
 *   ingredients  – Blätter mit Menge, Einheit, Name, Notiz
 *   equipment    – Geräte, die selbst vorbereitet werden (Ofen, Form)
 *   steps        – Handlungen; inputs verweisen auf Zutaten, Geräte oder frühere Schritte.
 *                  Wird eine Zutat mehrfach verwendet, trägt jeder Verweis einen Anteil (portion).
 */
(function (FK) {
  "use strict";
  const lex = FK.lex;

  const FRAC = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅕": 0.2 };
  const FRAC_RE = "[½¼¾⅓⅔⅛⅕]";
  const NUM_RE = "(?:\\d+-\\d+\\s*/\\s*\\d+|\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?(?:\\s*" + FRAC_RE + ")?|" + FRAC_RE + ")";

  function num1(s) {
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d+)-(\d+)\s*\/\s*(\d+)$/))) return +m[1] + m[2] / m[3]; // 1-1/4
    if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) return +m[1] + m[2] / m[3];
    if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) return m[1] / m[2];
    if ((m = s.match(new RegExp("^(\\d+(?:[.,]\\d+)?)?\\s*(" + FRAC_RE + ")?$"))) && (m[1] || m[2])) {
      return (m[1] ? parseFloat(m[1].replace(",", ".")) : 0) + (m[2] ? FRAC[m[2]] : 0);
    }
    return NaN;
  }

  /** "2-3", "1,5", "½", "1-1/4", "2 bis 3" → {min,max} */
  function parseQty(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/^(ca\.|etwa|circa|ungefähr|about|approx\.?)\s*/i, "");
    if (!s) return null;
    const range = s.match(new RegExp("^(" + NUM_RE + ")\\s*(?:-|–|—|bis|to)\\s*(" + NUM_RE + ")$"));
    if (range && !/^\d+-\d+\/\d+$/.test(s)) {
      const a = num1(range[1]), b = num1(range[2]);
      if (!isNaN(a) && !isNaN(b)) return { min: a, max: b };
    }
    const v = num1(s);
    return isNaN(v) ? null : { min: v, max: v };
  }

  function normQty(q) {
    if (q == null || q === "") return null;
    if (typeof q === "number") return isFinite(q) ? { min: q, max: q } : null;
    if (Array.isArray(q)) { const a = +q[0], b = q.length > 1 ? +q[1] : a; return isFinite(a) ? { min: a, max: isFinite(b) ? b : a } : null; }
    if (typeof q === "string") return parseQty(q);
    if (typeof q === "object") {
      const a = +q.min, b = q.max == null ? a : +q.max;
      return isFinite(a) ? { min: a, max: isFinite(b) ? b : a } : null;
    }
    return null;
  }

  const UNICODE_FRAC = [[0.5, "½"], [0.25, "¼"], [0.75, "¾"], [1 / 3, "⅓"], [2 / 3, "⅔"], [0.125, "⅛"]];
  function fmtNum(n, unit) {
    if (n == null || !isFinite(n)) return "";
    const u = (unit || "").toLowerCase();
    const fine = ["g", "ml", "mg"].includes(u);
    if (fine) {
      n = n >= 20 ? Math.round(n / 5) * 5 : Math.round(n);
      return String(n);
    }
    if (["kg", "l"].includes(u)) return (Math.round(n * 100) / 100).toString().replace(".", ",");
    const whole = Math.floor(n + 1e-9), rest = n - whole;
    if (rest < 0.04) return String(whole);
    for (const [v, ch] of UNICODE_FRAC) if (Math.abs(rest - v) < 0.04) return (whole ? whole : "") + ch;
    return (Math.round(n * 10) / 10).toString().replace(".", ",");
  }

  function fmtQty(q, factor, unit) {
    q = normQty(q);
    if (!q) return "";
    const f = factor || 1;
    const a = fmtNum(q.min * f, unit), b = fmtNum(q.max * f, unit);
    return a === b ? a : a + "–" + b;
  }

  function fmtAmount(ing, factor) {
    const q = fmtQty(ing.qty, factor, ing.unit);
    return [q, ing.unit || ""].filter(Boolean).join(" ");
  }

  function durText(d) {
    d = normDur(d);
    if (!d) return "";
    const f = (m) => (m >= 120 && m % 60 === 0 ? m / 60 + " h" : fmtNum(m) + "");
    const unit = d.min >= 120 && d.min % 60 === 0 && d.max % 60 === 0 ? "" : " min";
    return (d.est ? "≈ " : "") + (d.min === d.max ? f(d.min) : f(d.min) + "–" + f(d.max)) + unit;
  }

  function normDur(d) {
    if (d == null || d === "") return null;
    if (typeof d === "string") {
      const m = d.match(/(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?))?\s*(h|std|stunden?|min|minuten?)?/i);
      if (!m) return null;
      let a = parseFloat(m[1].replace(",", ".")), b = m[2] ? parseFloat(m[2].replace(",", ".")) : a;
      if (m[3] && /^(h|std|stunde)/i.test(m[3])) { a *= 60; b *= 60; }
      return { min: a, max: b };
    }
    const q = normQty(d);
    if (!q) return null;
    if (d && d.est) q.est = true;
    return q;
  }

  // ---- Schlüsselwörter zum Wiederfinden von Zutaten im Text -------------------------

  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 5 && /en$/.test(w) && !/(chen|ien)$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /[lr]n$/.test(w)) return w.slice(0, -1);
    if (w.length > 4 && /e$/.test(w)) return w.slice(0, -1);
    if (w.length > 4 && /(oes|ies)$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function keysFor(name) {
    const words = String(name || "").toLowerCase().replace(/[(),.]/g, " ").split(/\s+/).filter(Boolean);
    const core = words.filter((w) => !lex.ADJ.has(w));
    const keys = new Set();
    if (!core.length) return [];
    const head = core[core.length - 1];
    keys.add(stem(head));
    if (core.length > 1) keys.add(core.join(" "));
    for (const p of lex.PIECE) {
      if (head.endsWith(p) && head.length - p.length >= 3) keys.add(stem(head.slice(0, -p.length)));
    }
    for (const g of lex.SYNONYMS) if (g.some((w) => stem(w) === stem(head))) for (const w of g) keys.add(stem(w));
    return [...keys].filter((k) => k.length >= 2);
  }

  const STOP = new Set("der,die,das,den,dem,des,ein,eine,einen,einem,einer,und,oder,mit,ohne,in,im,an,am,auf,aus,bei,für,von,vom,zu,zum,zur,bis,nach,über,unter,etwa,ca,so,da,es,sie,er,the,a,an,and,of,with,on,to,for,it,or".split(","));

  function tokenMatchesKey(token, key) {
    if (key.includes(" ") || STOP.has(token)) return false;
    if (key.length >= 4 && token.includes(key)) return true;
    if (key.length < 4 && (token === key || (token.startsWith(key) && token.length <= key.length + 3))) return true;
    // Kurzform eines zusammengesetzten Namens: „Chili“ → Chilischote, „Öl“ → Olivenöl
    const t = stem(token);
    if (t.length >= 4 && key.length - t.length >= 3 && key.startsWith(t)) return true;
    if ((t.length >= 3 || t === "öl") && key.length - t.length >= 3 && key.endsWith(t)) return true;
    return false;
  }

  // ---- Modell -------------------------------------------------------------------------

  function emptyModel() {
    return { format: "flusskarte/1", title: "", servings: null, statedTime: "", ingredients: [], equipment: [], steps: [], lint: [], source: "" };
  }

  const str = (v) => (v == null ? "" : String(v)).trim();

  function normalize(raw) {
    const m = emptyModel();
    if (!raw || typeof raw !== "object") return m;
    m.title = str(raw.title) || "Rezept";
    const sv = parseFloat(raw.servings);
    m.servings = isFinite(sv) && sv > 0 ? sv : null;
    m.statedTime = str(raw.statedTime);
    m.source = str(raw.source);
    const used = new Set();
    const uid = (want, prefix, i) => {
      let id = str(want) || prefix + (i + 1);
      while (used.has(id)) id = id + "_";
      used.add(id);
      return id;
    };
    (raw.ingredients || []).forEach((z, i) => {
      if (!z || typeof z !== "object") return;
      m.ingredients.push({
        id: uid(z.id, "z", i), qty: normQty(z.qty), unit: str(z.unit), name: str(z.name) || "Zutat",
        note: str(z.note), optional: !!z.optional, missing: !!z.missing, line: str(z.line)
      });
    });
    (raw.equipment || []).forEach((g, i) => {
      if (!g || typeof g !== "object") return;
      m.equipment.push({ id: uid(g.id, "g", i), name: str(g.name) || "Gerät", note: str(g.note) });
    });
    (raw.steps || []).forEach((s, i) => {
      if (!s || typeof s !== "object") return;
      m.steps.push({
        id: uid(s.id, "s", i), verb: str(s.verb) || "?", detail: str(s.detail),
        inputs: (Array.isArray(s.inputs) ? s.inputs : []).map((x) => (typeof x === "string" ? { ref: x, portion: "" } : { ref: str(x && x.ref), portion: str(x && x.portion) })),
        dur: normDur(s.dur), temp: str(s.temp), passive: !!s.passive, repeat: str(s.repeat), cue: str(s.cue),
        note: str(s.note), product: str(s.product), src: str(s.src), srcStep: s.srcStep == null ? null : +s.srcStep,
        srcRange: Array.isArray(s.srcRange) && s.srcRange.length === 2 && s.srcRange.every((v) => isFinite(+v)) ? [+s.srcRange[0], +s.srcRange[1]] : null
      });
    });
    // ungültige Verweise entfernen (unbekannt oder auf sich selbst)
    const ids = new Set([...m.ingredients, ...m.equipment, ...m.steps].map((x) => x.id));
    for (const s of m.steps) s.inputs = s.inputs.filter((x) => x.ref && ids.has(x.ref) && x.ref !== s.id);
    m.lint = (Array.isArray(raw.lint) ? raw.lint : []).map((l) => (typeof l === "string" ? { level: "info", text: l, origin: "ai" } : { level: str(l.level) || "info", text: str(l.text), origin: str(l.origin) })).filter((l) => l.text);
    return m;
  }

  function index(m) {
    const byId = new Map();
    for (const z of m.ingredients) byId.set(z.id, { kind: "ingredient", node: z });
    for (const g of m.equipment) byId.set(g.id, { kind: "equipment", node: g });
    m.steps.forEach((s, i) => byId.set(s.id, { kind: "step", node: s, order: i }));
    const consumers = new Map(); // ref -> [{step, portion}]
    for (const s of m.steps) for (const inp of s.inputs) {
      if (!consumers.has(inp.ref)) consumers.set(inp.ref, []);
      consumers.get(inp.ref).push({ step: s, portion: inp.portion });
    }
    return { byId, consumers };
  }

  function participle(verb) {
    const v = String(verb || "").toLowerCase().split(/\s+/)[0];
    return lex.PARTICIPLE[v] || verb;
  }

  /** Gerät am Anfang der Hauptkette eines Schritts (Form → ausgestrichen → abgerieben). */
  function leadEquipment(step, idx, depth) {
    const first = step.inputs[0];
    if (!first || (depth || 0) > 40) return null;
    const e = idx.byId.get(first.ref);
    if (!e) return null;
    if (e.kind === "equipment") return e.node;
    if (e.kind === "step") return leadEquipment(e.node, idx, (depth || 0) + 1);
    return null;
  }

  /** Name des Zwischenprodukts eines Schritts: eigener Name oder abgeleitet. */
  function productLabel(m, step, idx) {
    if (step.product) return step.product;
    idx = idx || index(m);
    const eq = leadEquipment(step, idx);
    if (eq) return eq.name + " (" + participle(step.verb) + ")";
    const names = [], seen = new Set();
    (function walk(s, depth) {
      if (depth > 40) return;
      for (const inp of s.inputs) {
        const e = idx.byId.get(inp.ref);
        if (!e) continue;
        if (e.kind === "step") walk(e.node, depth + 1);
        else if (e.kind === "ingredient" && !seen.has(e.node.id)) { seen.add(e.node.id); names.push(e.node); }
      }
    })(step, 0);
    // Hauptzutaten zuerst: Reihenfolge der Zutatenliste
    names.sort((a, b) => m.ingredients.indexOf(a) - m.ingredients.indexOf(b));
    for (let i = 0; i < names.length; i++) names[i] = names[i].name;
    if (!names.length) {
      const eq = [];
      (function walk(s, depth) {
        if (depth > 40) return;
        for (const inp of s.inputs) {
          const e = idx.byId.get(inp.ref);
          if (!e) continue;
          if (e.kind === "step") walk(e.node, depth + 1); else if (e.kind === "equipment") eq.push(e.node.name);
        }
      })(step, 0);
      names.push(...eq);
    }
    const base = names.length > 2 ? names.slice(0, 2).join(", ") + " …" : names.join(" & ");
    return (base || "Ergebnis") + " (" + participle(step.verb) + ")";
  }

  function refLabel(m, ref, idx) {
    idx = idx || index(m);
    const e = idx.byId.get(ref);
    if (!e) return ref;
    if (e.kind === "step") return "#" + (e.order + 1) + " " + productLabel(m, e.node, idx);
    return e.node.name;
  }

  // ---- Konsistenzprüfung ------------------------------------------------------------

  function lint(m) {
    const out = [];
    const idx = index(m);
    const add = (level, text, ref) => out.push({ level, text, ref: ref || null, origin: "check" });

    for (const z of m.ingredients) {
      const uses = idx.consumers.get(z.id) || [];
      if (!uses.length && !z.optional) add("warn", `„${z.name}“ steht in der Zutatenliste, wird aber in keinem Schritt verwendet.`, z.id);
      if (!uses.length && z.optional) add("info", `Optionale Zutat „${z.name}“ ist keinem Schritt zugeordnet.`, z.id);
      if (z.missing) add("warn", `„${z.name}“ wird in der Zubereitung verwendet, fehlt aber in der Zutatenliste.`, z.id);
      if (uses.length > 1) {
        const purpose = (z.note + " " + z.name).match(/\b(für|zum|zur|for)\s+(die|den|das|the)?\s*([\wäöüß-]+)/i);
        if (purpose) add("warn", `„${z.name}“ ist „${purpose[0]}“ gelistet, wird aber ${uses.length}× verwendet. Die Menge reicht vermutlich nicht.`, z.id);
        const noPortion = uses.filter((u) => !u.portion).length;
        if (noPortion > 1) add("info", `„${z.name}“ wird ${uses.length}× verwendet, ohne dass die Aufteilung angegeben ist.`, z.id);
      }
    }
    for (const g of m.equipment) {
      if (!(idx.consumers.get(g.id) || []).length) add("info", `Gerät „${g.name}“ wird in keinem Schritt vorbereitet.`, g.id);
    }
    const sinks = m.steps.filter((s) => !(idx.consumers.get(s.id) || []).length);
    if (sinks.length > 1) {
      for (const s of sinks.slice(0, -1)) add("warn", `Schritt #${idx.byId.get(s.id).order + 1} „${s.verb}“ führt nirgendwohin. Sein Ergebnis wird später nicht verwendet.`, s.id);
    }
    for (const s of m.steps) {
      const o = idx.byId.get(s.id).order;
      if (!s.inputs.length) add("warn", `Schritt #${o + 1} „${s.verb}“ hat keine Eingänge.`, s.id);
      for (const inp of s.inputs) {
        const e = idx.byId.get(inp.ref);
        if (e && e.kind === "step" && e.order > o) add("warn", `Schritt #${o + 1} verwendet das Ergebnis von #${e.order + 1}, das erst später entsteht.`, s.id);
      }
      const multi = (idx.consumers.get(s.id) || []).length;
      if (multi > 1) add("info", `Das Ergebnis von #${o + 1} „${s.verb}“ wird ${multi}× weiterverwendet und erscheint in der Karte als Verweis.`, s.id);
    }
    if (hasCycle(m, idx)) add("error", "Die Schritte verweisen im Kreis aufeinander. Bitte Eingänge prüfen.");
    const ovenUsed = m.steps.some((s) => lex.OVEN.has(String(s.verb).toLowerCase().split(" ")[0]));
    const ovenPrepared = m.steps.some((s) => /vorheiz|preheat/i.test(s.verb));
    if (ovenUsed && !ovenPrepared) add("info", "Es wird gebacken, aber kein Schritt heizt den Ofen vor.");
    return out;
  }

  function hasCycle(m, idx) {
    const state = new Map();
    const visit = (id) => {
      const st = state.get(id);
      if (st === 1) return true;
      if (st === 2) return false;
      state.set(id, 1);
      const e = idx.byId.get(id);
      if (e && e.kind === "step") for (const inp of e.node.inputs) if (visit(inp.ref)) return true;
      state.set(id, 2);
      return false;
    };
    return m.steps.some((s) => visit(s.id));
  }

  function newId(m, prefix) {
    const ids = new Set([...m.ingredients, ...m.equipment, ...m.steps].map((x) => x.id));
    let i = 1;
    while (ids.has(prefix + i)) i++;
    return prefix + i;
  }

  FK.model = { parseQty, normQty, fmtNum, fmtQty, fmtAmount, durText, normDur, stem, keysFor, tokenMatchesKey, emptyModel, normalize, index, productLabel, refLabel, participle, lint, hasCycle, newId, NUM_RE };
})(window.FK = window.FK || {});
