/* Flusskarte – lokaler Parser: normales Rezept (Text) → Flussgraph.
 *
 * Ablauf:
 *  1. Abschnitte erkennen (Titel, Zutaten, Zubereitung), Portionen und Zeitangaben lesen.
 *  2. Zutatenzeilen in Menge, Einheit, Name, Notiz zerlegen.
 *  3. Jeden Zubereitungsschritt in Sätze und Handlungen teilen (ein Verb je Handlung).
 *  4. Zutaten in den Handlungen wiederfinden. Ein „Halter“ merkt sich, in welchem
 *     Zwischenprodukt eine Zutat gerade steckt; spätere Erwähnungen verweisen darauf.
 *  5. Handlungen ohne eigenes Ausgangsmaterial setzen das aktuelle Gericht fort.
 */
(function (FK) {
  "use strict";
  const lex = FK.lex, M = FK.model;

  const WORD_RE = /[A-Za-zÄÖÜäöüßéèàçâ]+(?:-[A-Za-zÄÖÜäöüßéèàçâ]+)*/g;
  const ABBR_RE = /\b(ca|z\.\s?B|bzw|evtl|ggf|Min|Std|Pck|Msp|EL|TL|Stk|St|Nr|etc|inkl|max|min|Tbs|tsp|oz|lb|lbs|approx|vgl)\./g;
  const ING_HDR = /^(zutaten|ingredients|einkaufsliste|du brauchst|you need|für den teig|für die)\b/i;
  const STEP_HDR = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|arbeitsschritte|instructions|directions|method|preparation|steps)\b/i;
  const DUR_RE = /(\d+(?:[,.]\d+)?)(?:\s*(?:-|–|bis|to)\s*(\d+(?:[,.]\d+)?))?\s*(Min(?:uten|\.)?|min\b|mins?\b|minutes?|Std\.?|Stunden?|h\b|hours?|hrs?)/i;
  const TEMP_RE = /(\d{2,3})\s*°\s*([CF])?/;
  const PRODUCT_PIECES = ["ringe", "ringen", "scheiben", "würfel", "streifen", "stifte", "spalten", "mischung", "masse", "soße", "sauce", "creme", "teig", "püree"];
  const NUMBER_WORDS = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, a: 1, an: 1, one: 1, two: 2, three: 3 };

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const words = (text) => { const out = []; let m; WORD_RE.lastIndex = 0; while ((m = WORD_RE.exec(text))) out.push({ w: m[0], lw: m[0].toLowerCase(), i: m.index }); return out; };

  // ---- Verben ---------------------------------------------------------------------

  // Infinitive, die keine Kochhandlung sind
  const NOT_VERBS = new Set("werden,sollen,sollten,können,müssen,haben,lassen,wollen,dürfen,mögen,bedecken,schmecken,aussehen,bleiben,kosten,gelingen,passen,reichen,stehen,liegen,geben,nehmen,machen,brauchen,verwenden,benötigen".split(","));

  /** Unbekanntes Verb raten: kleingeschriebener Infinitiv am Ende des Satzteils. */
  function guessVerb(ws) {
    for (let k = ws.length - 1; k >= Math.max(0, ws.length - 2); k--) {
      const t = ws[k];
      if (t.w[0] !== t.w[0].toLowerCase()) continue;
      if (/^[a-zäöüß]{4,}(en|ern|eln)$/.test(t.lw) && !NOT_VERBS.has(t.lw)) return { k, key: t.lw, e: { cls: "other" } };
    }
    return null;
  }

  function findVerb(text, opts) {
    if (/zum\s+(kochen|sieden)\s+bringen/i.test(text)) return { key: "aufkochen", display: "aufkochen", cls: "heat" };
    const ws = words(text);
    const cands = [];
    ws.forEach((t, k) => {
      const e = lex.V[t.lw];
      if (!e) return;
      const lower = t.w[0] === t.w[0].toLowerCase();
      if (!lower && k !== 0) return; // großgeschrieben mitten im Satz → Substantiv
      cands.push({ k, key: t.lw, e });
    });
    if (!cands.length && !(opts && opts.guess === false)) { const g = guessVerb(ws); if (g) cands.push(g); }
    if (!cands.length) return null;
    let c = cands[0].k === 0 && cands[0].e.en ? cands[0] : cands[cands.length - 1];
    let display = c.key;
    const nxt = ws[c.k + 1], prv = ws[c.k - 1], prv2 = ws[c.k - 2];
    if (nxt && nxt.lw === "lassen" && lex.LASSEN.has(c.key)) display += " lassen";
    if (prv && prv.lw === "oder" && prv2 && lex.V[prv2.lw]) {
      display = prv2.lw + " oder " + display;
      c = { k: c.k - 2, key: prv2.lw, e: lex.V[prv2.lw] };
    }
    return { key: c.key, display, cls: c.e.cls, en: !!c.e.en, k: c.k };
  }

  // ---- Titel & Zutaten ---------------------------------------------------------------

  function servingsFrom(text, model) {
    const sm = text.match(/\(?\s*(?:für\s+|serves\s+|for\s+)?(\d+(?:[.,]\d+)?)\s*(?:-\s*\d+\s*)?(portionen|portion|personen|person|pers\.|stück|servings?|people)\s*\)?/i)
      || text.match(/\b(?:serves|für)\s+(\d+)\b/i);
    if (!sm) return text;
    if (!model.servings) model.servings = parseFloat(sm[1].replace(",", "."));
    return (text.slice(0, sm.index) + text.slice(sm.index + sm[0].length)).replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/[\s(,–-]+$/, "").trim();
  }

  function splitTopLevel(s) {
    const parts = []; let depth = 0, last = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const rest = s.slice(i);
        const m = ch === "," ? [","] : rest.match(/^(\s+und\s+|\s*&\s*|\s+and\s+)/);
        if (m && (ch === "," || /^\s/.test(rest) || ch === "&")) {
          parts.push(s.slice(last, i)); i += m[0].length - 1; last = i + 1;
        }
      }
    }
    parts.push(s.slice(last));
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function multiIngredient(s) {
    const parts = splitTopLevel(s);
    if (parts.length < 2) return null;
    const allLower = s === s.toLowerCase();
    for (const p of parts) {
      const core = p.replace(/\([^)]*\)/g, "").trim();
      const ws = core.split(/\s+/).filter(Boolean);
      if (!ws.length || ws.length > 2 || /\d/.test(core)) return null;
      if (lex.ADJ.has(ws[0].toLowerCase())) return null;
      if (!(/^[A-ZÄÖÜ]/.test(core) || (allLower && ws.length === 1))) return null;
    }
    return parts;
  }

  function parseIngredientLine(line) {
    let s = line.trim().replace(/^[*•·\-–]\s*/, "").replace(/\*\*/g, "").trim();
    let optional = false;
    const om = s.match(/^(optional|nach belieben|evtl\.?|wahlweise|nach geschmack)\s*:?\s*/i);
    if (om) { optional = true; s = s.slice(om[0].length); }
    if (/\(\s*optional\s*\)|,\s*optional\s*$|\bnach belieben\b|\(?nach geschmack\)?$/i.test(s)) {
      optional = true;
      s = s.replace(/\(\s*optional\s*\)|,\s*optional\s*$|,?\s*nach belieben|,?\s*\(?nach geschmack\)?$/gi, "").trim();
    }
    const qm = s.match(new RegExp("^(?:ca\\.|etwa|circa)?\\s*(" + M.NUM_RE + "(?:\\s*(?:-|–|bis)\\s*" + M.NUM_RE + ")?)(?![\\d])\\s*", "i"));
    let qty = null, unit = "";
    if (qm && qm[1].trim()) { qty = M.parseQty(qm[1]); s = s.slice(qm[0].length); }
    const um = s.match(/^([A-Za-zÄÖÜäöüß]+\.?)(?=\s|$|,)/);
    if (um && lex.UNIT_MAP[um[1].toLowerCase()] && (qty || /^(prise|msp|schuss|pinch)/i.test(um[1]))) {
      const rest = s.slice(um[0].length).trim();
      if (rest) { unit = um[1]; s = rest; }
    }
    if (!qty && !unit) {
      const parts = multiIngredient(s);
      if (parts) return parts.flatMap((p) => parseIngredientLine(p).map((z) => Object.assign(z, { optional: z.optional || optional, line: line.trim() })));
    }
    const notes = [];
    s = s.replace(/\(([^)]*)\)/g, (_, x) => { if (x.trim()) notes.push(x.trim()); return " "; }).replace(/\s+/g, " ").trim();
    let name = s, note = "";
    const ci = s.indexOf(",");
    if (ci >= 0) { name = s.slice(0, ci).trim(); note = s.slice(ci + 1).trim(); }
    const fm = name.match(/\s+(für|zum|zur|zu|for)\s+.+$/i);
    if (fm) { note = [fm[0].trim(), note].filter(Boolean).join(", "); name = name.slice(0, fm.index).trim(); }
    if (!unit && /^[A-ZÄÖÜ][a-zäöüß]+zehen?$/.test(name) && name.length > 7) {
      unit = qty && qty.max > 1 ? "Zehen" : "Zehe";
      name = cap(name.replace(/zehen?$/i, ""));
    }
    return [{ id: "", qty, unit, name: name || s || line.trim(), note: [note, ...notes].filter(Boolean).join(", "), optional, missing: false, line: line.trim() }];
  }

  const isListLine = (t) => /^[*•·\-–]\s+/.test(t) || /^\d/.test(t) || /^[½¼¾⅓⅔]/.test(t);
  const isNumberedStep = (t) => /^\d+\s*[.)]\s+/.test(t);

  // ---- Hauptfunktion --------------------------------------------------------------------

  function parse(text) {
    const model = M.emptyModel();
    const src = String(text || "").replace(/\r\n?/g, "\n");
    model.source = src;
    const lines = []; let off = 0;
    for (const l of src.split("\n")) { lines.push({ text: l, start: off }); off += l.length + 1; }

    let mode = null, titleDone = false;
    const ingLines = [], stepLines = [];
    for (const L of lines) {
      const t = L.text.trim();
      if (!t) continue;
      const clean = t.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:\s*$/, "").trim();
      if (ING_HDR.test(clean) && clean.length < 60) { mode = "ing"; servingsFrom(clean, model); continue; }
      if (STEP_HDR.test(clean) && clean.length < 80) {
        mode = "steps";
        const pm = clean.match(/\(([^)]*)\)/) || clean.match(/:\s*(.+)$/);
        if (pm) model.statedTime = pm[1].trim();
        continue;
      }
      if (!titleDone && mode === null && !isListLine(t)) { model.title = servingsFrom(clean, model); titleDone = true; continue; }
      if (mode === "ing") ingLines.push(L);
      else if (mode === "steps") stepLines.push(L);
      else if (isNumberedStep(t)) stepLines.push(L);
      else if (isListLine(t)) ingLines.push(L);
      else stepLines.push(L);
    }
    if (!model.title) model.title = "Rezept";

    for (const L of ingLines) {
      for (const z of parseIngredientLine(L.text)) { z.id = M.newId(model, "z"); model.ingredients.push(z); }
    }
    for (const z of model.ingredients) z._keys = M.keysFor(z.name);

    const st = { model, holder: new Map(), consumed: new Set(), prev: null, pendingNotes: [], equip: new Map(), n: 0 };
    for (const L of stepLines) {
      const lead = L.text.match(/^\s*(?:(\d+)\s*[.)]|[*•·\-–])?\s*/);
      const body = L.text.slice(lead[0].length);
      if (!body.trim()) continue;
      const numbered = !!lead[1] || /^\s*[*•·\-–]/.test(L.text);
      if (numbered || !st.n || /^[A-ZÄÖÜ]/.test(body)) st.n++;
      processItem(st, body.replace(/\s+$/, ""), L.start + lead[0].length);
    }
    for (const z of model.ingredients) delete z._keys;
    return model;
  }

  function processItem(st, text, absStart) {
    const prot = text.replace(ABBR_RE, (m) => m.slice(0, -1) + "\u0001");
    const bounds = []; let last = 0, m;
    const bre = /[.!?]+(?:\s+|$)/g;
    while ((m = bre.exec(prot))) { const end = m.index + m[0].length; bounds.push([last, end]); last = end; }
    if (last < prot.length) bounds.push([last, prot.length]);
    bounds.forEach(([a, b], i) => {
      const raw = text.slice(a, b);
      const lead = raw.length - raw.trimStart().length;
      const sentence = raw.trim();
      if (sentence) processSentence(st, sentence, absStart + a + lead, i === 0);
    });
  }

  function lastStep(st) { return st.prev; }
  function appendField(step, field, text) {
    text = text.replace(/[.!?]+$/, "").trim();
    if (!text) return;
    step[field] = step[field] ? step[field] + "; " + text : text;
  }
  function attach(st, field, text) {
    const s = lastStep(st);
    if (s) appendField(s, field, text);
    else st.pendingNotes.push([field, text]);
  }

  function processSentence(st, sentence, absStart, firstInItem) {
    const s = sentence.replace(/[.!?]+\s*$/, "");
    if (/wiederhol|repeat/i.test(s) && !findVerb(s.replace(/wiederhol\w*|repeat\w*/gi, ""))) {
      const rep = s.match(/(\d+)(?:\s*(?:-|–|bis)\s*(\d+))?\s*(?:-?\s*mal|x|×|times)\b/i);
      const target = lastStep(st);
      if (target) target.repeat = rep ? rep[1] + (rep[2] ? "–" + rep[2] : "") : "mehrmals";
      return;
    }
    if (/^(nicht|kein|keine|keinen|tipp|hinweis|wichtig|achtung|tip|note|don'?t|do not|never)\b/i.test(s)) { attach(st, "note", s); return; }

    const lab = s.match(/^([A-Za-zÄÖÜäöüß]+)\s*:\s*/);
    if (lab) {
      const lv = lab[1].toLowerCase();
      if (lex.V[lv]) {
        makeAction(st, { text: s, offset: lab[0].length, labelVerb: lv, join: firstInItem ? "new" : "sentence", cue: "", src: sentence, absStart, ovenSentence: false });
        return;
      }
      if (/^(tipp|hinweis|info|achtung|wichtig|tip|note)$/i.test(lab[1])) { attach(st, "note", s.slice(lab[0].length)); return; }
    }

    let cue = "", core = s;
    const cm = s.match(/,?\s*\b(bis|until)\s+(?!\d)(.+?)(?=,\s*(?:dann|danach|anschließend|then)\b|$)/i);
    if (cm) { cue = cm[2].trim(); core = s.slice(0, cm.index) + " ".repeat(cm[0].length) + s.slice(cm.index + cm[0].length); }

    if (!findVerb(core, { guess: false })) {
      if (/\b(soll|sollte|sollen|muss|müssen|should|must)\b/i.test(core)) { attach(st, "cue", core.trim()); return; }
      if (!findVerb(core)) { attach(st, "note", core.trim()); return; }
    }

    const SEP = /\s*,\s+(?:(?:dann|danach|anschließend|und dann|then)\s+)?|\s*;\s*|\s+(?:und|and)\s+(?:(?:dann|then)\s+)?|\s+(?:dann|danach|then)\s+/gi;
    const segs = []; let last = 0, join = firstInItem ? "new" : "sentence", m;
    while ((m = SEP.exec(core))) {
      segs.push({ a: last, b: m.index, join });
      join = /und|and|dann|danach|anschließend|then/i.test(m[0]) ? "und" : ",";
      last = m.index + m[0].length;
    }
    segs.push({ a: last, b: core.length, join });
    const groups = []; let pending = [];
    for (const g of segs) {
      if (!core.slice(g.a, g.b).trim()) continue;
      pending.push(g);
      if (findVerb(core.slice(g.a, g.b))) { groups.push(pending); pending = []; }
    }
    if (pending.length) { if (groups.length) groups[groups.length - 1].push(...pending); else groups.push(pending); }

    const ovenSentence = s.split(/\s+/).some((w) => lex.OVEN.has(w.toLowerCase().replace(/[^a-zäöüß]/g, "")));
    groups.forEach((grp, k) => {
      const a = grp[0].a, b = grp[grp.length - 1].b, isLast = k === groups.length - 1;
      makeAction(st, {
        text: core.slice(a, b), offset: 0, join: k === 0 ? grp[0].join : grp[0].join,
        cue: isLast ? cue : "", src: sentence.slice(a, isLast ? sentence.length : b).trim(),
        absStart: absStart + a, ovenSentence
      });
    });
  }

  // ---- Erwähnungen ------------------------------------------------------------------------

  function portionBefore(body, pos) {
    const ws = body.slice(Math.max(0, pos - 48), pos).split(/\s+/).filter(Boolean).slice(-3).map((w) => w.toLowerCase().replace(/[^a-zäöüß½¼¾⅓⅔0-9,.]/g, ""));
    for (let k = ws.length; k >= 1; k--) {
      const tail = ws.slice(-k).join(" ");
      for (const [re, label, kind] of lex.PORTION_WORDS) {
        const mm = tail.match(re);
        if (mm && mm.index === 0) {
          const after = tail.slice(mm[0].length).trim();
          if (!after || /^(der|des|von|vom|of|the|an)$/.test(after)) {
            const text = label || mm[0].replace(/^(den|dem|der|die|das)\s+/, "");
            return { text, kind };
          }
        }
      }
    }
    const w1 = ws[ws.length - 1], w2 = ws[ws.length - 2];
    const numOf = (w) => (w == null ? null : NUMBER_WORDS[w] != null ? NUMBER_WORDS[w] : /^\d+(?:[,.]\d+)?$|^[½¼¾⅓⅔]$/.test(w) ? w : null);
    if (numOf(w1) != null) return { text: String(numOf(w1)), kind: "number" };
    if (numOf(w2) != null && w1 && /(te|ten|tes|ter)$/.test(w1)) return { text: String(numOf(w2)), adj: w1.replace(/(en|er|es|e)$/, ""), kind: "number" };
    return null;
  }

  function findMentions(st, body, skipRanges) {
    const out = [];
    const ws = words(body);
    for (const t of ws) {
      if (skipRanges.some(([a, b]) => t.i >= a && t.i < b)) continue;
      if (lex.TOOLS.includes(t.lw)) continue;
      const eq = lex.EQUIPMENT.find((e) => e.keys.some((k) => t.lw === k || (k.length >= 4 && t.lw.endsWith(k))));
      if (eq) {
        const after = body.slice(t.i + t.w.length).match(/^\s*\(([^)]*)\)/);
        out.push({ kind: "equipment", canon: eq.name, word: t.w, note: after ? after[1].trim() : "", pos: t.i });
        continue;
      }
      const parts = t.lw.split("-");
      const hits = [];
      for (const z of st.model.ingredients) {
        let best = 0;
        for (const key of z._keys) for (const p of parts) if (M.tokenMatchesKey(p, key)) best = Math.max(best, key.length);
        if (best) hits.push({ z, best });
      }
      if (!hits.length) {
        const food = lex.FOODS.find((f) => !f.includes(" ") && (t.lw === f || M.stem(t.lw) === M.stem(f)));
        if (food) hits.push({ z: addMissing(st, cap(food)), best: food.length });
      }
      if (!hits.length) continue;
      const productToken = hits.length > 1 || PRODUCT_PIECES.some((p) => t.lw.endsWith(p) && t.lw !== p);
      // je Wortteil nur die Zutat mit dem längsten Schlüssel
      const chosen = hits.length > 1 && parts.length === 1 ? [hits.sort((a, b) => b.best - a.best)[0]] : hits;
      const portion = portionBefore(body, t.i);
      const piece = ["flöckchen", "flocken"].find((p) => t.lw.endsWith(p) && t.lw !== p);
      for (const h of chosen) {
        let p = portion ? Object.assign({}, portion) : null;
        if (piece) p = { text: (p ? p.text + " " : "") + cap(piece), kind: "part" };
        else if (p && p.kind === "number") {
          const unitPiece = ["zehe", "zehen", "scheibe", "scheiben"].find((x) => t.lw.endsWith(x));
          p.text = p.text + (unitPiece ? " " + cap(unitPiece) : "") + (p.adj ? ", " + p.adj : "");
        }
        out.push({ kind: "ingredient", z: h.z, word: t.w, pos: t.i, portion: p, productToken });
      }
    }
    return out;
  }

  function addMissing(st, name) {
    const z = { id: M.newId(st.model, "z"), qty: null, unit: "", name, note: "", optional: false, missing: true, line: "" };
    z._keys = M.keysFor(name);
    st.model.ingredients.push(z);
    return z;
  }

  function extractDetail(body) {
    const found = [];
    const parens = [];
    { const re = /\([^)]*\)/g; let m; while ((m = re.exec(body))) parens.push([m.index, m.index + m[0].length]); }
    const inParens = (a) => parens.some(([x, y]) => a > x && a < y);
    const take = (re, fmt, allowInParens) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(body))) {
        const a = m.index, b = a + m[0].length;
        if ((allowInParens || !inParens(a)) && !found.some((f) => a < f.b && b > f.a)) found.push({ a, b, text: fmt ? fmt(m) : m[0] });
        if (!re.global) break;
      }
    };
    take(/\((\d{2,3})\s*°\s*C?\s*(Umluft|Heißluft)\)/gi, (m) => "(" + m[2] + " " + m[1] + " °C)", true);
    take(/\d+(?:[,.]\d+)?\s*(?:[-–]\s*\d+(?:[,.]\d+)?)?\s*(?:mm|cm)\b(?!\s*[×x])/gi);
    take(/\b(?:(?:sehr|ganz)\s+)?(?:(?:dünne|dünnen|dicke|dicken|feine|feinen|grobe|groben|kleine|kleinen|große|großen|gleichmäßige|mundgerechte)\s+)?(?:Scheiben|Ringe|Halbringe|Würfel|Streifen|Stifte|Spalten|Stücke|Röschen|wedges|slices|cubes|rings)\b/g);
    take(/\b(?:fein|grob|dünn|finely|thinly|coarsely)\b/gi);
    take(/Ober-\s*\/\s*Unterhitze|\bUmluft\b|\bHeißluft\b|bei\s+(?:mittlerer|starker|schwacher|hoher|niedriger|mäßiger)\s+Hitze|(?:low|medium|high)\s+heat/gi);
    take(/mit\s+(?:Alu)?folie(?:\s+(?:abgedeckt|zugedeckt))?|mit\s+(?:dem\s+)?Deckel|ohne\s+(?:Alu)?folie|ohne\s+Deckel|\babgedeckt\b|\bzugedeckt\b|\buncovered\b|\bcovered\b/gi);
    take(/(?:leicht\s+)?überlappend|schuppenartig|an den (?:Wänden|Rändern)|rundherum|skin (?:up|down)/gi);
    found.sort((x, y) => x.a - y.a);
    let out = "";
    found.forEach((f, i) => {
      if (i === 0) out = f.text;
      else out += (/^\s*$/.test(body.slice(found[i - 1].b, f.a)) ? " " : ", ") + f.text;
    });
    return out.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  }

  // ---- Handlung → Schritt -------------------------------------------------------------

  function equipNode(st, mention) {
    let g = st.model.equipment.find((x) => x.canon === mention.canon);
    if (!g) {
      g = { id: M.newId(st.model, "g"), name: cap(mention.word.replace(/^(den|die|das)\s+/i, "")), note: mention.note || "", canon: mention.canon };
      st.model.equipment.push(g);
    } else if (!g.note && mention.note) g.note = mention.note;
    return g;
  }

  function currentDish(st, exclude) {
    if (st.prev && !st.consumed.has(st.prev.id) && st.prev !== exclude) return st.prev;
    for (let i = st.model.steps.length - 1; i >= 0; i--) {
      const s = st.model.steps[i];
      if (s !== exclude && !st.consumed.has(s.id)) return s;
    }
    return null;
  }

  function makeAction(st, info) {
    const model = st.model;
    const body = info.text.slice(info.offset);
    const verb = info.labelVerb
      ? { key: info.labelVerb, display: info.labelVerb, cls: lex.V[info.labelVerb].cls, k: -1 }
      : findVerb(body) || { key: "", display: "?", cls: "other", k: -1 };
    const step = {
      id: M.newId(model, "s"), verb: verb.display, detail: "", inputs: [], dur: null, temp: "", passive: lex.PASSIVE.has(verb.key),
      repeat: "", cue: info.cue || "", note: "", product: "", src: info.src || body.trim(), srcStep: st.n,
      srcRange: [info.absStart, info.absStart + (info.src || body).length]
    };

    const dm = body.match(DUR_RE);
    if (dm) {
      let a = parseFloat(dm[1].replace(",", ".")), b = dm[2] ? parseFloat(dm[2].replace(",", ".")) : a;
      if (/^(std|stunde|h|hour|hr)/i.test(dm[3])) { a *= 60; b *= 60; }
      step.dur = { min: a, max: b };
    }
    const tm = body.match(TEMP_RE);
    if (tm) step.temp = tm[1] + " °" + (tm[2] || "C").toUpperCase();
    step.detail = extractDetail(body);

    // Wortbereiche des Verbs nicht als Zutat lesen
    const skip = [];
    if (!info.labelVerb) {
      const ws = words(body);
      for (const w of ws) if (verb.display.split(" ").includes(w.lw) && lex.V[w.lw] && w.w[0] === w.w[0].toLowerCase()) skip.push([w.i, w.i + w.w.length]);
    }
    const mentions = findMentions(st, body, skip).sort((a, b) => a.pos - b.pos);

    const inputs = [];
    const addInput = (ref, portion) => {
      const ex = inputs.find((x) => x.ref === ref);
      if (ex) { if (portion && !ex.portion) ex.portion = portion; return; }
      inputs.push({ ref, portion: portion || "" });
    };
    const fullRaw = [];
    let ovenMention = false;

    for (const men of mentions) {
      if (men.kind === "equipment") {
        if (men.canon === "Ofen") ovenMention = true;
        const holder = st.holder.get("eq:" + men.canon);
        if (verb.cls === "equip") {
          if (holder && !st.consumed.has(holder)) addInput(holder);
          else { const g = equipNode(st, men); addInput(g.id); st.holder.set("eq:" + men.canon, step.id); }
        } else if (holder && !st.consumed.has(holder) && men.canon !== "Ofen") addInput(holder);
        continue;
      }
      const z = men.z;
      const h = st.holder.get(z.id);
      const hUsable = h && !st.consumed.has(h);
      const portionText = men.portion ? men.portion.text : "";
      if (hUsable && (!men.portion || men.productToken)) {
        const cur = currentDish(st, step);
        if (verb.cls === "add" && cur && cur.id === h && !men.productToken) {
          addInput(z.id, portionText || "Rest");
        } else {
          addInput(h, men.productToken ? portionText : "");
          const hs = model.steps.find((x) => x.id === h);
          const lw = men.word.toLowerCase();
          if (hs && !hs.product && lw !== z.name.toLowerCase() && (men.productToken || lw.includes("-"))) hs.product = cap(men.word);
        }
      } else {
        addInput(z.id, portionText);
        if (!men.portion || men.portion.kind === "rest") fullRaw.push(z.id);
      }
    }

    if (verb.key === "vorheizen" || verb.key === "preheat") {
      if (!mentions.some((x) => x.kind === "equipment" && x.canon === "Ofen")) {
        const g = equipNode(st, { canon: "Ofen", word: "Ofen", note: "" });
        addInput(g.id); st.holder.set("eq:Ofen", step.id);
      }
      step.passive = true;
    }

    // Fortsetzung des aktuellen Gerichts
    const isStepRef = (ref) => model.steps.some((x) => x.id === ref);
    const rawIngredients = inputs.filter((x) => model.ingredients.some((z) => z.id === x.ref));
    const anaphor = /\b(darin|darauf|dazu|hinein|daran|darüber|obenauf|in it|on top|over it)\b/i.test(body);
    const newContainer = /\b(in|auf)\s+(eine|einer|einen|ein)\s+[\wäöüß-]*(schüssel|topf|pfanne|form|blech|bräter|glas|kasserolle)\b|\b(in|into)\s+an?\s+(?:\w+\s+)?(bowl|pan|pot|dish|skillet)\b/i.test(body);
    const cur = currentDish(st, step);
    const prevOpen = st.prev && !st.consumed.has(st.prev.id) ? st.prev : null;
    const included = (s) => s && inputs.some((x) => x.ref === s.id);
    let chainTo = null;
    if (anaphor && prevOpen && !included(prevOpen)) chainTo = prevOpen;                       // „darin“, „darauf“
    else if (!inputs.length) chainTo = cur;                                                   // nur Verb: am Gericht weiter
    else if (verb.cls === "add" && !newContainer && !included(cur)) chainTo = cur;            // etwas zum Gericht geben
    else if (info.join === "und" && verb.cls !== "equip" && !rawIngredients.length && prevOpen && !included(prevOpen)) chainTo = prevOpen; // „… abgießen und mit dem Öl schwenken“
    if (chainTo) inputs.unshift({ ref: chainTo.id, portion: "" });

    // Ofen anschließen: Backverben, Erwähnung des Ofens, oder abdecken mit Zeit in einem Backsatz
    const coverWithTime = (verb.key === "abdecken" || verb.key === "zudecken") && step.dur && info.ovenSentence;
    if (coverWithTime) {
      step.verb = "backen";
      if (/abgedeckt|zugedeckt/.test(step.detail)) { /* steht schon da */ }
      else if (/mit\s+(?:Alu)?folie|mit\s+(?:dem\s+)?Deckel/i.test(step.detail)) step.detail = step.detail.replace(/(mit\s+(?:Alu)?folie|mit\s+(?:dem\s+)?Deckel)/i, "$1 abgedeckt");
      else step.detail = step.detail ? "abgedeckt, " + step.detail : "abgedeckt";
      step.passive = true;
    }
    if (lex.OVEN.has(verb.key) || coverWithTime || (ovenMention && verb.cls !== "equip")) {
      const oh = st.holder.get("eq:Ofen");
      if (oh && !st.consumed.has(oh) && oh !== step.id && !inputs.some((x) => x.ref === oh)) inputs.push({ ref: oh, portion: "" });
    }

    step.inputs = inputs;
    model.steps.push(step);

    // Verbrauch & Halter weiterreichen
    for (const inp of inputs) {
      if (!isStepRef(inp.ref) || inp.ref === step.id) continue;
      st.consumed.add(inp.ref);
      for (const [k, v] of st.holder) if (v === inp.ref) st.holder.set(k, step.id);
    }
    for (const id of fullRaw) st.holder.set(id, step.id);

    for (const [field, text] of st.pendingNotes) appendField(step, field, text);
    st.pendingNotes = [];
    st.prev = step;
  }

  FK.parse = parse;
  FK.parser = { parse, parseIngredientLine, findVerb, extractDetail };
})(window.FK = window.FK || {});
