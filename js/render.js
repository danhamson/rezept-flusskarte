/* Flusskarte – HTML-Ausgabe: Flusskarte, Schichtplan, Zeitplan, Original. */
(function (FK) {
  "use strict";
  const M = FK.model, lex = FK.lex;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const attr = esc;

  function factorOf(m, servings) {
    return m.servings && servings ? servings / m.servings : 1;
  }

  /** Temperatur eines Backschritts: eigene oder die des vorgeheizten Ofens. */
  function ovenTemp(m, step, idx) {
    if (step.temp) return { temp: step.temp, inherited: false };
    if (!lex.OVEN.has(String(step.verb).toLowerCase().split(" ")[0])) return null;
    const seen = new Set();
    const walk = (s) => {
      if (seen.has(s.id)) return null;
      seen.add(s.id);
      for (const inp of s.inputs) {
        const e = idx.byId.get(inp.ref);
        if (!e || e.kind !== "step") continue;
        const t = e.node;
        if (t.temp && (/vorheiz|preheat/i.test(t.verb) || lex.OVEN.has(String(t.verb).toLowerCase().split(" ")[0]))) return t.temp;
        const r = walk(t);
        if (r) return r;
      }
      return null;
    };
    const t = walk(step);
    return t ? { temp: t, inherited: true } : null;
  }

  function notesOf(m) {
    const list = [];
    m.steps.forEach((s, i) => { if (s.note) list.push({ n: list.length + 1, step: s, order: i, text: s.note }); });
    return list;
  }

  function leafAmount(row, factor) {
    if (row.kind !== "ingredient") return "";
    return row.portion ? M.scalePortion(row.portion, factor) : M.fmtAmount(row.node, factor);
  }

  // ---- Kochen: abgehakte Schritte, Timer -----------------------------------------------------

  /** Erledigte Schritte, die ausgeblendet werden dürfen: alle Verbraucher und der ganze Ast davor sind erledigt.
   *  Ein erledigter Schritt, dessen Ergebnis noch gebraucht wird, bleibt als „Spalte davor“ sichtbar. */
  function collapsible(m, done, idx) {
    const out = new Set();
    if (!done || !done.size) return out;
    idx = idx || M.index(m);
    const memo = new Map();
    const branchDone = (s, guard) => {
      if (memo.has(s.id)) return memo.get(s.id);
      if (guard.has(s.id)) return false;
      guard.add(s.id);
      const ok = done.has(s.id) && s.inputs.every((inp) => { const e = idx.byId.get(inp.ref); return !e || e.kind !== "step" || branchDone(e.node, guard); });
      memo.set(s.id, ok);
      return ok;
    };
    for (const s of m.steps) {
      const cons = idx.consumers.get(s.id) || [];
      if (cons.length && cons.every((c) => done.has(c.step.id)) && branchDone(s, new Set())) out.add(s.id);
    }
    return out;
  }

  /** Dauer als Timer-Knopf (nur in der App) oder als Marke (Druck, Export). */
  function timeTag(s, opts, cls) {
    const d = M.durText(s.dur);
    if (!d) return "";
    if (!opts || !opts.timers) return '<span class="tag tag-time">' + esc(d) + "</span>";
    return '<button type="button" class="tag tag-time tmr' + (cls ? " " + cls : "") + '" data-timer="' + attr(s.id) + '" title="Timer starten" aria-label="Timer ' + esc(d) + ' starten">' +
      '<svg class="ic-t" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="5.5"/><path d="M8 6v3l2 1.5M6.5 1.5h3"/></svg><span class="tmr-t">' + esc(d) + "</span></button>";
  }

  // ---- Flusskarte (erweitert) ------------------------------------------------------------

  function flowCard(m, opts) {
    const factor = factorOf(m, opts.servings);
    const idx = M.index(m);
    const done = opts.done || null;
    const L = FK.layout.build(m, opts.hideDone ? { collapse: collapsible(m, done, idx) } : null);
    const notes = notesOf(m);
    const noteOf = new Map(notes.map((n) => [n.step.id, n.n]));
    if (!L.rows.length) return { html: emptyCard(), layout: L, notes };
    let h = '<table class="fk fk-flow" id="card-table"><thead><tr><th class="h-amt" scope="col">Menge</th><th class="h-ing" scope="col">Zutat</th>';
    if (L.cols) h += '<th class="h-ops" scope="col" colspan="' + L.cols + '">Arbeitsschritte → </th>';
    h += "</tr></thead><tbody>";
    L.rows.forEach((row, r) => {
      const treeStart = r > 0 && L.rows[r - 1].tree !== row.tree;
      h += "<tr" + (treeStart ? ' class="tree-start"' : "") + ">";
      // data-for: Verbraucher der Zeile, damit ein Haken die Zeile ohne Neuaufbau grau färben kann
      const dn = row.kind !== "done" && done && done.has(row.consumer) ? " done" : "";
      const dfor = row.kind !== "done" && row.consumer ? ' data-for="' + attr(row.consumer) + '"' : "";
      h += leafCellsFlow(row, factor).replace(/<td class="(amt|ing)([^"]*)"/g, '<td class="$1$2' + dn + '"' + dfor);
      for (let c = 1; c <= L.cols; c++) {
        const cell = L.grid[r][c - 1];
        if (!cell || cell.r0 !== r || cell.c0 !== c) continue;
        const span = (cell.rows > 1 ? ' rowspan="' + cell.rows + '"' : "") + (cell.cols > 1 ? ' colspan="' + cell.cols + '"' : "");
        if (cell.type === "fill") h += '<td class="fill' + (done && done.has(cell.consumer) ? " done" : "") + '" data-for="' + attr(cell.consumer) + '"' + span + ' aria-hidden="true"></td>';
        else if (cell.type === "blank") h += '<td class="blank"' + span + ' aria-hidden="true"></td>';
        else h += opCellFlow(m, cell, span, idx, noteOf, opts);
      }
      h += "</tr>";
    });
    h += "</tbody></table>";
    return { html: h, layout: L, notes };
  }

  function leafCellsFlow(row, factor) {
    const dataRef = row.ref ? ' data-ing="' + attr(row.ref) + '"' : "";
    if (row.kind === "done") {
      return '<td class="amt done-row"><span class="chk" aria-hidden="true">✓</span></td><td class="ing done-row" data-step="' + attr(row.step.id) + '" title="Erledigt und ausgeblendet">' +
        '<span class="nm">' + esc(row.label) + '</span> <span class="sr-only">erledigt</span></td>';
    }
    if (row.kind === "equipment") {
      return '<td class="amt eq"' + dataRef + '><span class="tag tag-eq">Gerät</span></td><td class="ing eq"' + dataRef + '><span class="nm">' + esc(row.node.name) + "</span>" +
        (row.node.note ? ' <span class="nt">' + esc(row.node.note) + "</span>" : "") + "</td>";
    }
    if (row.kind === "ref") {
      return '<td class="amt ref">' + esc(M.scalePortion(row.portion, factor)) + '</td><td class="ing ref" data-step="' + attr(row.step.id) + '"><span class="nm">' + esc(row.label) + "</span></td>";
    }
    if (row.kind !== "ingredient") return '<td class="amt"></td><td class="ing"></td>';
    const z = row.node;
    const amt = leafAmount(row, factor);
    let tags = "";
    if (row.uses > 1) tags += ' <span class="tag tag-split" title="Diese Zutat wird aufgeteilt">Teil ' + row.use + "/" + row.uses + "</span>";
    if (z.optional) tags += ' <span class="tag tag-opt">optional</span>';
    if (z.missing) tags += ' <span class="tag tag-miss" title="Wird in der Zubereitung genannt, fehlt aber in der Zutatenliste">fehlt in Liste</span>';
    const total = row.portion && z.qty ? '<span class="of">von ' + esc(M.fmtAmount(z, factor)) + "</span>" : "";
    return '<td class="amt"' + dataRef + ">" + esc(amt) + '</td><td class="ing"' + dataRef + '><span class="nm">' + esc(z.name) + "</span>" +
      (z.note && row.use === 1 ? ' <span class="nt">' + esc(z.note) + "</span>" : "") + total + tags + "</td>";
  }

  function opCellFlow(m, cell, span, idx, noteOf, opts) {
    const s = cell.step;
    const cls = ["op"];
    if (s.passive) cls.push("passive");
    const isDone = !!(opts.done && opts.done.has(s.id));
    if (isDone) cls.push("done");
    const t = ovenTemp(m, s, idx);
    let meta = "";
    if (t) meta += '<span class="tag tag-heat' + (t.inherited ? " inh" : "") + '"' + (t.inherited ? ' title="Temperatur des vorgeheizten Ofens"' : "") + ">" + esc(t.temp) + "</span>";
    meta += timeTag(s, opts);
    if (s.repeat) meta += '<span class="tag tag-rep" title="wiederholen">×' + esc(s.repeat) + "</span>";
    const fn = noteOf.get(s.id);
    const interactive = !!opts.timers;
    const a11y = interactive ? ' tabindex="0" role="checkbox" aria-checked="' + isDone + '" title="Antippen: abhaken · Doppelklick: bearbeiten"' : "";
    return '<td class="' + cls.join(" ") + '"' + span + ' data-step="' + attr(s.id) + '"' + a11y + ">" +
      '<div class="op-in"><span class="op-n">' + (cell.order + 1) + "</span>" + (interactive ? '<span class="op-chk" aria-hidden="true">✓</span>' : "") +
      '<span class="op-v">' + esc(s.verb) + (fn ? '<sup class="fn">' + fn + "</sup>" : "") + "</span>" +
      (s.detail ? '<span class="op-d">' + esc(s.detail) + "</span>" : "") +
      (meta ? '<span class="op-m">' + meta + "</span>" : "") +
      (s.cue ? '<span class="op-c">✓ ' + esc(s.cue) + "</span>" : "") +
      (s.product ? '<span class="op-p">→ ' + esc(s.product) + "</span>" : "") +
      "</div></td>";
  }

  function emptyCard() {
    return '<div class="empty-card"><p>Noch keine Schritte erkannt.</p><p>Füge links ein Rezept mit Zutatenliste und nummerierten Schritten ein.</p></div>';
  }

  // ---- Schichtplan ------------------------------------------------------------------------

  function layerPlans(m) {
    const idx = M.index(m);
    const plans = [];
    const containsEquipment = (s, guard) => {
      guard = guard || new Set();
      if (guard.has(s.id)) return false;
      guard.add(s.id);
      return s.inputs.some((inp) => { const e = idx.byId.get(inp.ref); return e && (e.kind === "equipment" || (e.kind === "step" && containsEquipment(e.node, guard))); });
    };
    const labelOf = (inp) => {
      const e = idx.byId.get(inp.ref);
      if (!e) return null;
      const base = e.kind === "step" ? (e.node.product || M.productLabel(m, e.node, idx)) : e.node.name;
      return { ref: inp.ref, text: base, portion: inp.portion, ingredient: e.kind === "ingredient" ? e.node.id : firstIngredient(e.node) };
    };
    const firstIngredient = (s, guard) => {
      guard = guard || new Set();
      if (!s || guard.has(s.id)) return null;
      guard.add(s.id);
      for (const inp of s.inputs) {
        const e = idx.byId.get(inp.ref);
        if (!e) continue;
        if (e.kind === "ingredient") return e.node.id;
        if (e.kind === "step") { const r = firstIngredient(e.node, guard); if (r) return r; }
      }
      return null;
    };
    m.steps.forEach((s, i) => {
      if (!/schicht|layer|assemble/i.test(s.verb)) return;
      let base = null;
      const layers = [];
      for (const inp of s.inputs) {
        const e = idx.byId.get(inp.ref);
        if (!e) continue;
        if (e.kind === "equipment" || (e.kind === "step" && containsEquipment(e.node))) { base = base || labelOf(inp); continue; }
        const l = labelOf(inp);
        if (l) layers.push(l);
      }
      const top = [];
      let cur = s;
      for (let guard = 0; guard < 6; guard++) {
        const next = (idx.consumers.get(cur.id) || [])[0];
        if (!next) break;
        const ns = next.step;
        const cls = (lex.V[String(ns.verb).toLowerCase().split(" ")[0]] || {}).cls;
        if (cls !== "add") break;
        for (const inp of ns.inputs) {
          const e = idx.byId.get(inp.ref);
          if (e && e.kind !== "step") { const l = labelOf(inp); if (l) top.push(Object.assign(l, { step: ns.id })); }
        }
        cur = ns;
      }
      if (layers.length) plans.push({ step: s, order: i, base, layers, top, repeat: s.repeat });
    });
    return plans;
  }

  function layerHtml(m, factor) {
    const plans = layerPlans(m);
    const layerLi = (l, color, where) => layerItem(l, color, where, factor);
    if (!plans.length) return "";
    const colors = new Map();
    const colorFor = (id) => { if (!colors.has(id)) colors.set(id, (colors.size % 6) + 1); return colors.get(id); };
    let h = "";
    for (const p of plans) {
      h += '<figure class="layers" data-step="' + attr(p.step.id) + '"><figcaption>Schichtplan zu Schritt ' + (p.order + 1) + " „" + esc(p.step.verb) + "“</figcaption><ol class=\"stack\">";
      for (const l of p.top.slice().reverse()) h += layerLi(l, colorFor(l.ingredient || l.ref), "obenauf");
      h += '<li class="rep-group"><ol>';
      for (const l of p.layers.slice().reverse()) h += layerLi(l, colorFor(l.ingredient || l.ref), "");
      h += "</ol>" + (p.repeat ? '<span class="rep-mark">×' + esc(p.repeat) + "</span>" : "") + "</li>";
      if (p.base) h += '<li class="base"><span class="sw sw-base"></span><span class="lt">' + esc(p.base.text) + '</span><span class="lp">Boden</span></li>';
      h += "</ol></figure>";
    }
    return h;
  }

  function layerItem(l, color, where, factor) {
    return '<li data-ing="' + attr(l.ingredient || l.ref) + '"><span class="sw sw-' + color + '"></span><span class="lt">' + esc(l.text) + "</span>" +
      (l.portion ? '<span class="lp">' + esc(M.scalePortion(l.portion, factor)) + "</span>" : where ? '<span class="lp">' + where + "</span>" : "") + "</li>";
  }

  // ---- Zeitplan ----------------------------------------------------------------------------

  function timelineHtml(m, opts) {
    opts = opts || {};
    const done = opts.done || null;
    const sc = FK.schedule.plan(m);
    if (!sc.items.length) return emptyCard();
    const total = Math.max(sc.total, 1);
    const tick = total > 150 ? 30 : total > 60 ? 10 : 5;
    let ticks = "";
    for (let t = 0; t <= total; t += tick) ticks += '<span class="tick" style="left:' + (t / total * 100).toFixed(3) + '%">' + t + "</span>";
    let rows = "";
    for (const it of sc.items) {
      const left = it.start / total * 100, width = Math.max((it.end - it.start) / total * 100, 0.6);
      const isDone = !!(done && done.has(it.step.id));
      if (isDone && opts.hideDone) continue;
      const a11y = opts.timers ? ' tabindex="0" role="checkbox" aria-checked="' + isDone + '" title="Antippen: abhaken"' : "";
      rows += '<div class="tl-row' + (isDone ? " done" : "") + '" data-step="' + attr(it.step.id) + '"' + a11y + '><div class="tl-label">' + (opts.timers ? '<span class="op-chk" aria-hidden="true">✓</span>' : "") +
        '<span class="tl-txt"><span class="op-n">' + (it.order + 1) + "</span> " + esc(it.step.verb) +
        (it.step.detail ? ' <span class="tl-det">' + esc(it.step.detail) + "</span>" : "") + "</span>" + (opts.timers ? timeTag(it.step, opts, "sm") : "") + '</div><div class="tl-track"><div class="tl-bar' + (it.passive ? " passive" : "") + (it.est ? " est" : "") +
        '" style="left:' + left.toFixed(3) + "%;width:" + width.toFixed(3) + '%"><span>' + it.start + "–" + it.end + "</span></div></div></div>";
    }
    const stated = m.statedTime ? '<div class="tl-stated">Angabe im Rezept: ' + esc(m.statedTime) + "</div>" : "";
    return '<div class="timeline"><div class="tl-summary"><div><b>' + sc.total + '</b><span>Minuten gesamt</span></div><div><b>' + sc.active +
      '</b><span>Minuten Handarbeit</span></div><div><b>' + (sc.total - sc.active) + '</b><span>Minuten Warten</span></div></div>' + stated +
      '<div class="tl-scroll"><div class="tl-grid"><div class="tl-axis"><div></div><div class="tl-ticks">' + ticks + "</div></div>" + rows + "</div></div>" +
      '<p class="tl-legend"><span class="key k-act"></span> Hände beschäftigt <span class="key k-pas"></span> Warten (Ofen, Ruhen) <span class="key k-est"></span> Dauer geschätzt. ' +
      "Eine Person kocht: aktive Schritte laufen nacheinander, Wartezeiten parallel. Schritte auf dem längsten Weg kommen zuerst.</p></div>";
  }

  // ---- Original mit Markierungen -------------------------------------------------------------

  function originalHtml(m) {
    const src = m.source || "";
    if (!src.trim()) return '<div class="empty-card"><p>Kein Originaltext vorhanden.</p></div>';
    const marks = [];
    for (const s of m.steps) {
      let r = s.srcRange;
      if (!r && s.src) { const i = src.indexOf(s.src); if (i >= 0) r = [i, i + s.src.length]; }
      if (r && r[1] > r[0] && r[1] <= src.length) marks.push({ a: r[0], b: r[1], step: s.id });
    }
    marks.sort((x, y) => x.a - y.a);
    const clean = [];
    for (const mk of marks) if (!clean.length || mk.a >= clean[clean.length - 1].b) clean.push(mk);
    const keyed = m.ingredients.map((z) => ({ id: z.id, keys: M.keysFor(z.name) }));
    const hiIng = (text) => esc(text).replace(/[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g, (w) => {
      const lw = w.toLowerCase();
      const parts = lw.split("-");
      const hit = keyed.find((k) => k.keys.some((key) => parts.some((p) => M.tokenMatchesKey(p, key))));
      return hit ? '<mark data-ing="' + attr(hit.id) + '">' + w + "</mark>" : w;
    });
    let out = "", pos = 0;
    for (const mk of clean) {
      out += hiIng(src.slice(pos, mk.a));
      out += '<span class="src-step" data-step="' + attr(mk.step) + '">' + hiIng(src.slice(mk.a, mk.b)) + "</span>";
      pos = mk.b;
    }
    out += hiIng(src.slice(pos));
    return '<div class="original">' + out + "</div>";
  }

  // ---- Eigenständiges HTML zum Speichern ---------------------------------------------------------

  const STANDALONE_COLORS = { grid: "#3f9a47", accent: "#2c7a35", muted: "#5b6a61", ink: "#17221c", heat: "#a8520f", wait: "#46698b", "wait-bg": "#e3ebf3", warn: "#8f5200" };
  const standaloneCss = (c) => `body{font:14px/1.35 "Barlow Semi Condensed","Trebuchet MS",Arial,sans-serif;color:${c.ink};background:#fff;margin:24px}
h1{font-size:20px;margin:0 0 4px}p.meta{color:${c.muted};margin:0 0 12px}
table{border-collapse:collapse;border:2px solid ${c.grid}}td,th{border:1px solid ${c.grid};padding:4px 6px;vertical-align:middle}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${c.muted}}
td.fill{border-right:0}td.blank{border:0}td.amt{text-align:right;white-space:nowrap;font-family:"IBM Plex Mono",monospace;font-size:12px}
td.op{text-align:center;min-width:6rem;max-width:11rem}td.op.passive{background:repeating-linear-gradient(135deg,${c["wait-bg"]} 0 6px,#fff 6px 12px)}
.op-in{display:flex;flex-direction:column;gap:2px;align-items:center}.op-n{font-size:10px;color:${c.muted}}.op-v{font-weight:600}
.op-d,.op-c,.op-p{font-size:12px;color:${c.muted}}.op-p{color:${c.accent}}.tag{display:inline-block;font-size:11px;border:1px solid currentColor;border-radius:3px;padding:0 3px;margin:1px}
.tag-heat{color:${c.heat}}.tag-time{color:${c.wait}}.tag-rep,.tag-split{color:${c.accent}}.tag-opt{color:${c.muted}}.tag-miss{color:${c.warn}}.tag-eq{color:${c.muted}}
.nt,.of{display:block;font-size:12px;color:${c.muted}}td.eq{font-style:italic}
ol.notes{font-size:13px;color:${c.muted}}`;

  function standaloneHtml(m, opts) {
    const card = flowCard(m, opts);
    const notes = notesOf(m);
    const meta = [m.servings ? M.fmtNum(opts.servings || m.servings) + " Portionen" : "", m.statedTime].filter(Boolean).join(" · ");
    const colors = Object.assign({}, STANDALONE_COLORS, opts.colors || {});
    return "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + esc(m.title) + "</title><style>" + standaloneCss(colors) + "</style></head><body>" +
      "<h1>" + esc(m.title) + "</h1><p class=\"meta\">" + esc(meta) + "</p>" + card.html +
      (notes.length ? "<ol class=\"notes\">" + notes.map((n) => "<li>" + esc(n.text) + "</li>").join("") + "</ol>" : "") +
      "<p class=\"meta\">Erstellt mit Rezept-Flusskarte</p></body></html>";
  }

  // ---- Lesbarer Rezepttext aus dem Modell (für geladene Codes ohne Originaltext) --------------------

  function plainText(m) {
    const lines = [m.title + (m.servings ? " (" + M.fmtNum(m.servings) + " Portionen)" : ""), "", "Zutaten", ""];
    for (const z of m.ingredients) lines.push("* " + [M.fmtAmount(z), z.name].filter(Boolean).join(" ") + (z.note ? ", " + z.note : "") + (z.optional ? " (optional)" : ""));
    lines.push("", "Zubereitung" + (m.statedTime ? " (" + m.statedTime + ")" : ""), "");
    m.steps.forEach((s, i) => {
      const t = s.src || [s.detail, s.verb].filter(Boolean).join(" ");
      lines.push(i + 1 + ". " + t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : "."));
    });
    return lines.join("\n");
  }

  FK.render = { esc, flowCard, collapsible, layerHtml, layerPlans, timelineHtml, originalHtml, notesOf, standaloneHtml, factorOf, plainText };
})(window.FK = window.FK || {});
