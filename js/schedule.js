/* Flusskarte – Zeitplan: eine Person kocht, Wartezeiten laufen parallel.
 * Aktive Schritte belegen die Hände nacheinander; passive Schritte (Ofen, Ruhen)
 * beginnen, sobald ihre Eingänge fertig sind. Bei freier Wahl kommt zuerst der
 * Schritt mit dem längsten Restweg (kritischer Pfad). Danach rückt ein
 * Rückwärtsdurchlauf alles, dessen Ergebnis erst später gebraucht wird, so spät
 * wie möglich vor seinen Verbraucher (Nudeln erst kurz vor dem Servieren).
 * Der Ofen hat eine Temperatur: Backschritte mit verschiedenen Temperaturen überlappen nie.
 */
(function (FK) {
  "use strict";
  const M = FK.model, lex = FK.lex;
  const EPS = 1e-9;

  function durationOf(s) {
    const d = M.normDur(s.dur);
    if (d) return { min: (d.min + d.max) / 2, est: !!d.est };
    const key = String(s.verb || "").toLowerCase().split(/\s+/)[0];
    const e = lex.ESTIMATE;
    const v = e.verb[key] != null ? e.verb[key] : e.cls[(lex.V[key] || {}).cls || "other"];
    return { min: v * (s.repeat ? 1.5 : 1), est: true };
  }

  const verbKey = (s) => String(s.verb || "").toLowerCase().split(/\s+/)[0];

  /** Ofentemperatur eines Backschritts (eigene oder die des vorgeheizten Ofens); null, wenn kein Ofen. */
  function ovenOf(s, idx) {
    if (!lex.OVEN.has(verbKey(s))) return null;
    const num = (t) => { const m = String(t || "").match(/\d+/); return m ? +m[0] : null; };
    if (s.temp) return { temp: num(s.temp) };
    const seen = new Set();
    const walk = (x) => {
      for (const inp of x.inputs) {
        const e = idx.byId.get(inp.ref);
        if (!e || e.kind !== "step" || seen.has(inp.ref)) continue;
        seen.add(inp.ref);
        const t = e.node;
        if (t.temp && (/vorheiz|preheat/i.test(t.verb) || lex.OVEN.has(verbKey(t)))) return num(t.temp);
        const r = walk(t);
        if (r != null) return r;
      }
      return null;
    };
    return { temp: walk(s) };
  }
  // Ein Ofen hat eine Temperatur: Backschritte mit verschiedenen Temperaturen laufen nacheinander
  const clash = (a, b) => a.oven && b.oven && a.oven.temp != null && b.oven.temp != null && a.oven.temp !== b.oven.temp;

  // Spätestes Ende ≤ limit, zu dem ein aktiver Schritt der Dauer dur in keine
  // belegte Zeit fällt: Jeder Treffer im Fenster erzwingt ein Ende vor seinem Beginn.
  function latestSlot(busy, limit, dur) {
    let e = limit, hit;
    do {
      hit = busy.filter((b) => b.start < e - EPS && b.end > e - dur + EPS);
      if (hit.length) e = Math.min(...hit.map((b) => b.start));
    } while (hit.length);
    return e;
  }

  // Rückwärtsdurchlauf: nach Ende absteigend, Verbraucher vor ihren Eingängen.
  // Jeder Schritt rückt bis an den frühesten Beginn seiner Verbraucher, aktive nur
  // in Lücken der Hände. Die alte Lage bleibt dabei stets zulässig, also wird nichts
  // früher und das Ende nicht später; Schritte ohne Verbraucher bleiben stehen.
  function justify(items, idx) {
    const byId = new Map(items.map((it) => [it.step.id, it]));
    const consumersOf = (it) => (idx.consumers.get(it.step.id) || []).map((c) => byId.get(c.step.id)).filter((c) => c && c !== it);
    const done = new Set();
    const todo = items.slice().sort((a, b) => b.end - a.end || b.start - a.start);
    while (todo.length) {
      let k = todo.findIndex((it) => consumersOf(it).every((c) => done.has(c)));
      const free = k >= 0;
      if (!free) k = 0; // Kreis: an Ort und Stelle lassen
      const it = todo.splice(k, 1)[0];
      const cons = consumersOf(it);
      if (free && cons.length) {
        const limit = Math.min(...cons.map((c) => c.start));
        const dur = it.end - it.start;
        const busy = it.passive ? (it.oven ? items.filter((o) => o !== it && clash(o, it)) : null) : items.filter((o) => o !== it && !o.passive);
        const e = busy ? latestSlot(busy, limit, dur) : limit;
        if (e > it.end + EPS) { it.start = e - dur; it.end = e; }
      }
      done.add(it);
    }
    const first = Math.min(...items.map((i) => i.start));
    if (first > EPS) for (const it of items) { it.start -= first; it.end -= first; }
  }

  function plan(m) {
    const idx = M.index(m);
    const steps = m.steps;
    const info = new Map(steps.map((s, i) => { const d = durationOf(s); return [s.id, { step: s, order: i, dur: d.min, est: d.est, passive: !!s.passive, oven: ovenOf(s, idx) }]; }));
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
        let start = readyAt(s);
        // Ofen belegt mit anderer Temperatur: warten, bis er frei ist
        for (let hit; (hit = items.filter((o) => clash(o, it) && o.start < start + it.dur - EPS && o.end > start + EPS)).length;) start = Math.max(...hit.map((o) => o.end));
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
    justify(items, idx);
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
