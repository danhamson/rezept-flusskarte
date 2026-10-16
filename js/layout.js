/* Flusskarte – Tabellenlayout.
 *
 *   – Spalte 0: je Zutat eine Zeile.
 *   – Jede Operation ist eine Zelle mit rowspan über alle Zeilen ihrer Eingänge.
 *   – Spalten laufen von links nach rechts in Arbeitsreihenfolge; eine Operation steht
 *     eine Spalte rechts von ihrem spätesten Eingang.
 *   – Leere Füllzellen (rechter Rand ausgeblendet) verlängern Zeilen, deren Zutat erst
 *     später dazukommt.
 *   – Das Modell ist ein Graph. Mehrfach genutzte Zutaten werden je Verwendung zu einer
 *     eigenen Zeile (mit Anteil), mehrfach genutzte Zwischenprodukte erscheinen ab der
 *     zweiten Verwendung als Verweiszeile.
 */
(function (FK) {
  "use strict";
  const M = FK.model;

  function build(m) {
    const idx = M.index(m);
    const steps = m.steps;
    const order = new Map(steps.map((s, i) => [s.id, i]));

    // Eingänge ohne gültigen Verweis überspringen
    const eff = new Map();
    const effInputs = (s) => {
      if (!eff.has(s.id)) eff.set(s.id, s.inputs.filter((inp) => idx.byId.has(inp.ref)));
      return eff.get(s.id);
    };
    const live = steps;

    // Besitzer eines Zwischenprodukts = erster Verbraucher
    const owner = new Map();
    for (const s of live) for (const inp of effInputs(s)) {
      const e = idx.byId.get(inp.ref);
      if (e && e.kind === "step" && !owner.has(inp.ref)) owner.set(inp.ref, s.id);
    }
    const sinks = live.filter((s) => !owner.has(s.id));

    // Nutzungen je Zutat zählen (für "Teil 1/2")
    const useCount = new Map(), useSeen = new Map();
    for (const s of live) for (const inp of effInputs(s)) {
      const e = idx.byId.get(inp.ref);
      if (e && e.kind !== "step") useCount.set(inp.ref, (useCount.get(inp.ref) || 0) + 1);
    }

    const minOrder = new Map();
    const subtreeMin = (s, guard) => {
      if (minOrder.has(s.id)) return minOrder.get(s.id);
      guard = guard || new Set();
      if (guard.has(s.id)) return order.get(s.id);
      guard.add(s.id);
      let v = order.get(s.id);
      for (const inp of effInputs(s)) {
        const e = idx.byId.get(inp.ref);
        if (e && e.kind === "step" && owner.get(inp.ref) === s.id) v = Math.min(v, subtreeMin(e.node, guard));
      }
      minOrder.set(s.id, v);
      return v;
    };

    const rows = [];
    const cells = [];
    const placed = new Set();

    function leafRow(inp, consumer) {
      const e = idx.byId.get(inp.ref);
      const r = { index: rows.length, consumer: consumer.id, ref: inp.ref, portion: inp.portion || "" };
      if (e.kind === "step") {
        r.kind = "ref"; r.step = e.node; r.order = order.get(e.node.id);
        r.label = "→ #" + (r.order + 1) + " " + M.productLabel(m, e.node, idx);
      } else {
        r.kind = e.kind; r.node = e.node;
        const n = (useSeen.get(inp.ref) || 0) + 1; useSeen.set(inp.ref, n);
        r.use = n; r.uses = useCount.get(inp.ref) || 1;
        r.label = e.node.name;
      }
      rows.push(r);
      return r;
    }

    // liefert {r0, r1, col}
    function place(s, depth) {
      if (placed.has(s.id) || depth > 80) return null;
      placed.add(s.id);
      const ins = effInputs(s).slice();
      const kids = ins.map((inp, i) => {
        const e = idx.byId.get(inp.ref);
        const own = e && e.kind === "step" && owner.get(inp.ref) === s.id && !placed.has(inp.ref);
        return { inp, i, step: own ? e.node : null, key: own ? subtreeMin(e.node) : Infinity };
      });
      kids.sort((a, b) => (a.key - b.key) || (a.i - b.i));
      const spans = [];
      for (const k of kids) {
        if (k.step) {
          const sp = place(k.step, depth + 1);
          if (sp) { spans.push(sp); continue; }
        }
        const r = leafRow(k.inp, s);
        spans.push({ r0: r.index, r1: r.index, col: 0, leaf: true });
      }
      if (!spans.length) { const r = { index: rows.length, kind: "empty", label: "", consumer: s.id }; rows.push(r); spans.push({ r0: r.index, r1: r.index, col: 0, leaf: true }); }
      const col = Math.max(...spans.map((x) => x.col)) + 1;
      const r0 = Math.min(...spans.map((x) => x.r0)), r1 = Math.max(...spans.map((x) => x.r1));
      cells.push({ type: "op", step: s, order: order.get(s.id), r0, rows: r1 - r0 + 1, c0: col, cols: 1 });
      // Füllzellen: benachbarte Eingänge gleicher Tiefe zusammenfassen
      let i = 0;
      while (i < spans.length) {
        let j = i;
        while (j + 1 < spans.length && spans[j + 1].col === spans[i].col && spans[j + 1].r0 === spans[j].r1 + 1) j++;
        if (spans[i].col < col - 1) {
          cells.push({ type: "fill", r0: spans[i].r0, rows: spans[j].r1 - spans[i].r0 + 1, c0: spans[i].col + 1, cols: col - 1 - spans[i].col, consumer: s.id });
        }
        i = j + 1;
      }
      return { r0, r1, col };
    }

    const trees = [];
    for (const s of sinks) {
      const r0 = rows.length;
      const sp = place(s, 0);
      if (sp) trees.push({ r0, r1: rows.length - 1, cols: sp.col, sink: s });
    }
    // Reste (z. B. Kreise) als eigene Bäume
    for (const s of live) if (!placed.has(s.id)) {
      const r0 = rows.length;
      const sp = place(s, 0);
      if (sp) trees.push({ r0, r1: rows.length - 1, cols: sp.col, sink: s });
    }
    const cols = Math.max(0, ...trees.map((t) => t.cols));
    for (const t of trees) if (t.cols < cols) cells.push({ type: "blank", r0: t.r0, rows: t.r1 - t.r0 + 1, c0: t.cols + 1, cols: cols - t.cols });

    // Raster: grid[r][c-1] → Zelle
    const grid = rows.map(() => new Array(cols).fill(null));
    for (const c of cells) for (let r = c.r0; r < c.r0 + c.rows; r++) for (let k = c.c0; k < c.c0 + c.cols; k++) if (grid[r]) grid[r][k - 1] = c;
    trees.forEach((t, i) => { for (let r = t.r0; r <= t.r1; r++) rows[r].tree = i; });

    const unused = m.ingredients.filter((z) => !useCount.has(z.id));
    return { rows, cells, grid, cols, trees, unused };
  }

  FK.layout = { build };
})(window.FK = window.FK || {});
