/* Flusskarte – Zeitplan: eine Person kocht, Wartezeiten laufen parallel.
 * Aktive Schritte belegen die Hände nacheinander; passive Schritte (Ofen, Ruhen)
 * beginnen, sobald ihre Eingänge fertig sind. Bei freier Wahl kommt zuerst der
 * Schritt mit dem längsten Restweg (kritischer Pfad).
 */
(function (FK) {
  "use strict";
  const M = FK.model, lex = FK.lex;

  function durationOf(s) {
    const d = M.normDur(s.dur);
    if (d) return { min: (d.min + d.max) / 2, est: !!d.est };
    const key = String(s.verb || "").toLowerCase().split(/\s+/)[0];
    const e = lex.ESTIMATE;
    const v = e.verb[key] != null ? e.verb[key] : e.cls[(lex.V[key] || {}).cls || "other"];
    return { min: v * (s.repeat ? 1.5 : 1), est: true };
  }

  function plan(m) {
    const idx = M.index(m);
    const steps = m.steps;
    const info = new Map(steps.map((s, i) => { const d = durationOf(s); return [s.id, { step: s, order: i, dur: d.min, est: d.est, passive: !!s.passive }]; }));
    const tail = new Map();
    const tailOf = (id, guard) => {
      if (tail.has(id)) return tail.get(id);
      guard = guard || new Set();
      if (guard.has(id)) return 0;
      guard.add(id);
      const it = info.get(id);
      const next = (idx.consumers.get(id) || []).map((c) => tailOf(c.step.id, guard));
      const v = it.dur + (next.length ? Math.max(...next) : 0);
      tail.set(id, v);
      return v;
    };
    steps.forEach((s) => tailOf(s.id));

    const end = new Map();
    const stepInputs = (s) => s.inputs.map((x) => x.ref).filter((r) => info.has(r));
    const readyAt = (s) => Math.max(0, ...stepInputs(s).map((r) => end.get(r)));
    const isReady = (s) => stepInputs(s).every((r) => end.has(r));
    const items = [];
    let cook = 0, guard = 0;
    while (items.length < steps.length && guard++ < steps.length * 4 + 10) {
      let progressed = false;
      for (const s of steps) {
        const it = info.get(s.id);
        if (end.has(s.id) || !it.passive || !isReady(s)) continue;
        const start = readyAt(s);
        end.set(s.id, start + it.dur);
        items.push({ ...it, start, end: start + it.dur });
        progressed = true;
      }
      const cands = steps.filter((s) => !end.has(s.id) && !info.get(s.id).passive && isReady(s));
      if (cands.length) {
        const now = cands.filter((s) => readyAt(s) <= cook);
        const pool = now.length ? now : [cands.reduce((a, b) => (readyAt(a) <= readyAt(b) ? a : b))];
        pool.sort((a, b) => tail.get(b.id) - tail.get(a.id) || info.get(a.id).order - info.get(b.id).order);
        const s = pool[0], it = info.get(s.id);
        const start = Math.max(cook, readyAt(s));
        end.set(s.id, start + it.dur);
        cook = start + it.dur;
        items.push({ ...it, start, end: start + it.dur });
        progressed = true;
      }
      if (!progressed) {
        // Kreis oder fehlende Eingänge: Rest hinten anhängen
        for (const s of steps) if (!end.has(s.id)) {
          const it = info.get(s.id), start = cook;
          end.set(s.id, start + it.dur); cook += it.passive ? 0 : it.dur;
          items.push({ ...it, start, end: start + it.dur });
        }
      }
    }
    const round = (v) => Math.round(v);
    for (const it of items) { it.start = round(it.start); it.end = round(it.end); }
    items.sort((a, b) => a.start - b.start || a.order - b.order);
    const total = Math.max(0, ...items.map((i) => i.end));
    const active = round(items.filter((i) => !i.passive).reduce((a, i) => a + (i.end - i.start), 0));
    const estimated = items.some((i) => i.est);
    return { items, total, active, estimated };
  }

  FK.schedule = { plan, durationOf };
})(window.FK = window.FK || {});
