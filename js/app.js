/* Flusskarte – Oberfläche: Eingabe, Ansichten, Struktur-Editor, Export, Teilen, KI-Prompt, PDF. */
(function (FK) {
  "use strict";
  const M = FK.model, R = FK.render, esc = FK.render.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const SAMPLE = `Vegetarisches Kartoffelgratin mit Parmesan und Muskat (4 Portionen)
Zutaten

* 1 kg Kartoffeln, vorwiegend festkochend
* 300 ml Sahne
* 200 ml Milch
* 2 Zwiebeln (ca. 150 g)
* 2-3 Knoblauchzehen
* 70-80 g Parmesan, fein gerieben
* 1 EL Butter für die Form
* Salz (sparsam), Pfeffer
* ½ TL gemahlener Muskat
* Optional: 1-2 TL frischer Thymian

Zubereitung (ca. 20 Min. aktiv, 60-70 Min. Ofen)

1. Ofen auf 180 °C Ober-/Unterhitze (160 °C Umluft) vorheizen. Eine Auflaufform (ca. 25×30 cm) mit Butter ausstreichen und eine halbierte Knoblauchzehe an den Wänden abreiben.
2. Kartoffeln schälen und in 2-3 mm dünne Scheiben hobeln. Nicht wässern, die Stärke bindet die Soße.
3. Zwiebeln in dünne Ringe schneiden, den restlichen Knoblauch fein hacken oder pressen.
4. Sahne und Milch mit Knoblauch, Pfeffer, Muskat, Thymian und wenig Salz verrühren.
5. Schichten: Kartoffeln leicht überlappend in die Form, Zwiebelringe und etwas Parmesan darauf, dann einen Teil der Sahne-Milch-Mischung. Das 3-4 Mal wiederholen. Die Flüssigkeit soll die Kartoffeln fast bedecken.
6. Mit dem restlichen Parmesan abschließen und ein paar Butterflöckchen darauf verteilen.
7. Die ersten 35-40 Min. mit Alufolie abdecken, dann 25-30 Min. ohne Folie backen, bis die Oberfläche goldbraun ist und ein Messer ohne Widerstand durchgeht.
8. 5-10 Min. ruhen lassen, dann schneiden.`;

  const STORE = "flusskarte.v1";
  const ORIGIN_LABEL = { local: "lokal umgewandelt", ai: "von KI umgewandelt", manual: "von Hand bearbeitet", import: "aus JSON geladen", code: "aus Rezept-Code geladen" };
  const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5];
  const S = {
    text: "", model: null, origin: "local", view: "flow", left: "text", servings: null, staleText: false,
    mob: "in", zoom: 1, pdf: Object.assign({}, FK.print.DEFAULTS), shareSrc: true, done: [], hideDone: false,
    downloads: null, inArtifact: !!(window.claude && window.claude.use)
  };
  const narrow = () => matchMedia("(max-width: 959.98px)").matches;

  // ---- Speicher (nur Bequemlichkeit, pro Browser) ----------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (typeof d.text !== "string") return false;
      S.text = d.text;
      S.model = d.model ? M.normalize(d.model) : null;
      if (S.model && d.model) S.model.source = d.model.source || d.text;
      S.origin = d.origin === "claude" ? "ai" : ORIGIN_LABEL[d.origin] ? d.origin : "local";
      S.view = ["flow", "timeline", "original", "json"].includes(d.view) ? d.view : "flow";
      S.left = d.left === "struct" ? "struct" : "text";
      S.servings = d.servings || null;
      S.staleText = !!d.staleText;
      S.mob = d.mob === "out" ? "out" : "in";
      S.zoom = d.zoom === "fit" || ZOOMS.includes(d.zoom) ? d.zoom : 1;
      if (d.pdf && typeof d.pdf === "object") for (const k of Object.keys(FK.print.DEFAULTS)) if (typeof d.pdf[k] === typeof FK.print.DEFAULTS[k]) S.pdf[k] = d.pdf[k];
      S.shareSrc = d.shareSrc !== false;
      S.done = Array.isArray(d.done) ? d.done.filter((x) => typeof x === "string") : [];
      S.hideDone = !!d.hideDone;
      return true;
    } catch (e) { return false; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({ text: S.text, model: S.model, origin: S.origin, view: S.view, left: S.left, servings: S.servings, staleText: S.staleText, mob: S.mob, zoom: S.zoom, pdf: S.pdf, shareSrc: S.shareSrc, done: S.done, hideDone: S.hideDone }));
      } catch (e) { /* privat oder blockiert */ }
    }, 250);
  }

  // ---- Umwandeln ---------------------------------------------------------------------------
  function convertLocal() {
    S.model = FK.parse(S.text);
    S.origin = "local";
    S.staleText = false;
    S.servings = S.model.servings;
    afterModelChange(true);
  }

  /** Fertiges Modell übernehmen (KI, Code, JSON); der vorige Stand lässt sich zurückholen. */
  function adopt(m, origin, text, message) {
    const prev = { text: S.text, model: S.model, origin: S.origin, servings: S.servings, staleText: S.staleText, done: S.done };
    S.model = m; S.origin = origin; S.servings = m.servings; S.staleText = false; S.done = [];
    if (typeof text === "string") { S.text = text; $("#src").value = text; }
    afterModelChange(true);
    showMobScrolled("out");
    toast(message, {
      label: "Rückgängig",
      run: () => {
        Object.assign(S, prev);
        $("#src").value = S.text;
        afterModelChange(true);
        toast("Vorheriger Stand wiederhergestellt");
      }
    });
  }

  async function loadCode(text) {
    const raw = await FK.share.decode(text);
    const m = M.normalize(raw);
    if (!m.ingredients.length && !m.steps.length) throw new Error("Der Code enthält kein Rezept.");
    const src = m.source || R.plainText(m);
    FK.ai.attachSource(m, src);
    adopt(m, "code", src, "Rezept-Code geladen: " + m.title);
  }

  function afterModelChange(structural) {
    if (S.model && S.done.length) { const ids = new Set(S.model.steps.map((s) => s.id)); S.done = S.done.filter((id) => ids.has(id)); }
    save();
    renderHeader();
    renderView();
    renderBelow();
    if (S.left === "struct" && structural) renderEditor();
    renderStatus();
  }

  function markManual() {
    if (S.origin !== "manual") { S.origin = "manual"; renderStatus(); }
  }

  // ---- Status & Kopf --------------------------------------------------------------------
  let statusOverride = null;
  function setStatus(text, warn) { statusOverride = { text, warn }; renderStatus(); }
  function renderStatus() {
    const el = $("#status");
    el.classList.remove("warn");
    if (statusOverride) {
      el.textContent = statusOverride.text;
      if (statusOverride.warn) el.classList.add("warn");
      statusOverride = null;
      return;
    }
    if (!S.model) { el.textContent = ""; return; }
    const m = S.model;
    const parts = [m.ingredients.length + " Zutaten", m.steps.length + " Schritte"];
    el.innerHTML = '<span class="badge">' + esc(ORIGIN_LABEL[S.origin] || "") + "</span>" + esc(parts.join(" · ")) +
      (S.staleText ? ' <span class="warn-text">· Der Text wurde danach geändert. „Umwandeln“ übernimmt ihn und verwirft die Bearbeitung.</span>' : "");
    if (S.staleText) el.classList.add("warn");
  }

  function renderHeader() {
    const m = S.model;
    $("#recipe-title").textContent = m ? m.title : "Rezept";
    const meta = [];
    if (m && m.servings) meta.push(M.fmtNum(S.servings || m.servings) + " Portionen" + (S.servings && S.servings !== m.servings ? " (Original " + M.fmtNum(m.servings) + ")" : ""));
    if (m && m.statedTime) meta.push(m.statedTime);
    $("#recipe-meta").textContent = meta.join(" · ");
    const sv = $("#sv");
    const has = !!(m && m.servings);
    sv.disabled = $("#sv-minus").disabled = $("#sv-plus").disabled = !has;
    sv.value = has ? String(S.servings || m.servings) : "";
    sv.title = has ? "" : "Das Rezept nennt keine Portionenzahl";
    document.title = m && m.title && m.title !== "Rezept" ? m.title + " · Rezept-Flusskarte" : "Rezept-Flusskarte";
  }

  // ---- Ansichten ------------------------------------------------------------------------------
  function renderView() {
    const el = $("#view");
    $$('.pane-out [role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === S.view)));
    const m = S.model;
    if (!m) { el.innerHTML = '<div class="empty-card"><p>Noch kein Rezept umgewandelt.</p></div>'; return; }
    const done = new Set(S.done);
    const opts = { servings: S.servings || m.servings, done, hideDone: S.hideDone, timers: true };
    if (S.view === "flow") {
      const card = R.flowCard(m, opts);
      el.innerHTML = '<div class="card-tools">' + cookTools(m, done) + '<div class="zoom-tools" role="group" aria-label="Kartengröße">' +
        '<button type="button" class="icon-btn" data-zoom="-1" aria-label="Kleiner">−</button>' +
        '<span class="zoom-val" id="zoom-val"></span>' +
        '<button type="button" class="icon-btn" data-zoom="1" aria-label="Größer">+</button>' +
        '<button type="button" class="btn ghost sm" data-zoom="fit" aria-pressed="' + (S.zoom === "fit") + '">Einpassen</button></div></div>' +
        '<div class="card-scroll" id="card-scroll">' + card.html + "</div>" +
        '<p class="legend"><span><span class="sw-pass"></span>Wartezeit, Hände frei</span><span><span class="tag tag-split">Teil 1/2</span> aufgeteilte Zutat</span>' +
        '<span><span class="tag tag-heat">180 °C</span> <span class="tag tag-time">35 min</span> Hitze und Dauer</span><span>✓ fertig, wenn …</span><span>→ Name des Zwischenprodukts</span><span>Schritt antippen: abhaken · Doppelklick: bearbeiten · Zeit antippen: Timer</span></p>';
      applyZoom();
    } else if (S.view === "timeline") {
      el.innerHTML = '<div class="card-tools">' + cookTools(m, done) + "</div>" + R.timelineHtml(m, opts);
    } else if (S.view === "original") {
      el.innerHTML = R.originalHtml(m) + '<p class="legend">Unterstrichen: erkannte Zutaten. Fährt man über einen Satz, leuchtet der passende Schritt auf.</p>';
    } else {
      el.innerHTML = '<div class="json-tools"><button type="button" class="btn" data-act="json-copy">Kopieren</button><button type="button" class="btn" data-act="json-apply">Änderungen übernehmen</button>' +
        '<label class="btn ghost" for="json-file">JSON-Datei öffnen</label><input type="file" id="json-file" accept=".json,application/json" hidden></div>' +
        '<textarea id="json-edit" spellcheck="false" aria-label="Flusskarte als JSON">' + esc(JSON.stringify(exportModel(m), null, 2)) + '</textarea><p class="json-err" id="json-err"></p>';
    }
    FK.kitchen.paint();
  }

  // ---- Kochen: abhaken, ausblenden, Timer ---------------------------------------------------------
  function cookTools(m, done) {
    const n = m.steps.filter((s) => done.has(s.id)).length;
    if (!n) return '<p class="cook-hint">Erledigte Schritte antippen, um sie abzuhaken.</p>';
    return '<div class="cook-tools" role="group" aria-label="Fortschritt"><span class="cook-n"><b>' + n + "</b>/" + m.steps.length + " erledigt</span>" +
      '<button type="button" class="btn ghost sm" data-cook="hide" aria-pressed="' + S.hideDone + '" title="Erledigte Äste einklappen; die Spalte vor einem offenen Schritt bleibt sichtbar">Erledigtes ausblenden</button>' +
      '<button type="button" class="btn ghost sm" data-cook="reset">Zurücksetzen</button></div>';
  }

  // Haken an Ort und Stelle setzen: kein Neuaufbau, damit ein Doppelklick dasselbe Feld trifft.
  // Nur beim Ausblenden ändert sich die Karte; dann kurz danach neu aufbauen.
  let doneTimer = 0;
  function setDone(id, on) {
    const has = S.done.includes(id);
    if (on == null) on = !has;
    if (on === has) return;
    S.done = on ? S.done.concat(id) : S.done.filter((x) => x !== id);
    save();
    const v = $("#view"), q = window.CSS && CSS.escape ? CSS.escape(id) : id;
    $$('[data-step="' + q + '"][role="checkbox"]', v).forEach((el) => { el.classList.toggle("done", on); el.setAttribute("aria-checked", String(on)); });
    $$('[data-for="' + q + '"]', v).forEach((el) => el.classList.toggle("done", on));
    const slot = $(".card-tools > :first-child", v);
    if (slot && S.model) slot.outerHTML = cookTools(S.model, new Set(S.done));
    if (S.hideDone || !slot) {
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        const f = document.activeElement && document.activeElement.closest && document.activeElement.closest("#view [data-step][tabindex]");
        const fid = f && f.dataset.step;
        renderView();
        const again = fid && $('#view [data-step="' + (window.CSS && CSS.escape ? CSS.escape(fid) : fid) + '"][tabindex]');
        if (again) again.focus({ preventScroll: true });
      }, 450);
    }
  }

  function startTimer(id) {
    const m = S.model, i = m ? m.steps.findIndex((s) => s.id === id) : -1;
    if (i < 0) return;
    const s = m.steps[i], d = M.normDur(s.dur);
    if (!d) return;
    FK.kitchen.start(id, i + 1 + ". " + [s.verb, s.product ? "→ " + s.product : s.detail].filter(Boolean).join(" "), d.min, M.durText(d));
  }

  // ---- Kartengröße (vor allem für Handy und Tablet) ------------------------------------------------
  function applyZoom() {
    const box = $("#card-scroll"), table = box && box.querySelector("table.fk");
    if (!table) return;
    let z = S.zoom;
    if (z === "fit") {
      if (!box.clientWidth) return; // gerade ausgeblendet (Handy, Rezept-Ansicht)
      table.style.zoom = "";
      z = Math.max(0.3, Math.min(1.5, (box.clientWidth - 2) / Math.max(table.offsetWidth, 1)));
    }
    table.style.zoom = z === 1 ? "" : String(z);
    const val = $("#zoom-val");
    if (val) val.textContent = Math.round(z * 100) + " %";
    const fitBtn = $('#view [data-zoom="fit"]');
    if (fitBtn) fitBtn.setAttribute("aria-pressed", String(S.zoom === "fit"));
  }

  function stepZoom(dir) {
    const box = $("#card-scroll"), table = box && box.querySelector("table.fk");
    const cur = S.zoom === "fit" ? (table ? parseFloat(table.style.zoom) || 1 : 1) : S.zoom;
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.001) : ZOOMS.slice().reverse().find((z) => z < cur - 0.001);
    if (next == null) return;
    S.zoom = next; applyZoom(); save();
  }

  function exportModel(m) {
    const out = JSON.parse(JSON.stringify(m));
    delete out.lint;
    for (const s of out.steps) { delete s.srcRange; }
    return out;
  }

  function renderBelow() {
    const el = $("#below");
    const m = S.model;
    if (!m || S.view === "json") { el.innerHTML = ""; el.className = "below"; return; }
    const blocks = [];
    if (S.view === "flow") {
      const notes = R.notesOf(m);
      if (notes.length) blocks.push('<section class="box"><h3>Anmerkungen</h3><ol class="notes">' + notes.map((n) => '<li data-step="' + esc(n.step.id) + '">' + esc(n.text) + ' <span class="ref">(Schritt ' + (n.order + 1) + ")</span></li>").join("") + "</ol></section>");
      const layers = R.layerHtml(m, R.factorOf(m, S.servings || m.servings));
      if (layers) blocks.push('<section class="box">' + layers + "</section>");
    }
    blocks.push(lintHtml(m));
    el.className = "below" + (blocks.length > 1 ? " two" : "");
    el.innerHTML = blocks.join("");
  }

  function lintHtml(m) {
    const items = M.lint(m).concat((m.lint || []).map((l) => Object.assign({ origin: "ai" }, l)));
    const label = { warn: "Achtung", error: "Fehler", info: "Hinweis" };
    if (!items.length) return '<section class="box"><h3>Prüfung des Rezepts</h3><p class="ok">Keine Lücken gefunden: Jede Zutat wird verwendet, jeder Schritt führt zum Gericht.</p></section>';
    const order = { error: 0, warn: 1, info: 2 };
    items.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
    return '<section class="box"><h3>Prüfung des Rezepts</h3><ul class="lint">' + items.map((l) => {
      const ref = l.ref ? (m.steps.some((s) => s.id === l.ref) ? ' data-step="' + esc(l.ref) + '"' : ' data-ing="' + esc(l.ref) + '"') : "";
      return '<li class="' + esc(l.level) + '"' + ref + '><span class="lv">' + (label[l.level] || "Hinweis") + "</span><span>" + esc(l.text) + (l.origin === "ai" || l.origin === "claude" ? ' <span class="src">(KI)</span>' : "") + "</span></li>";
    }).join("") + "</ul></section>";
  }

  // ---- Struktur-Editor ---------------------------------------------------------------------
  function fmtQtyEdit(q) {
    q = M.normQty(q);
    if (!q) return "";
    const f = (n) => M.fmtNum(n, "");
    return q.min === q.max ? f(q.min) : f(q.min) + "–" + f(q.max);
  }
  function fmtDurEdit(d) {
    d = M.normDur(d);
    if (!d) return "";
    return d.min === d.max ? M.fmtNum(d.min) : M.fmtNum(d.min) + "–" + M.fmtNum(d.max);
  }
  const fid = (...p) => "f-" + p.join("-").replace(/[^A-Za-z0-9_-]/g, "_");

  function field(label, id, path, value, extra) {
    return '<label class="f' + (extra && extra.cls ? " " + extra.cls : "") + '" for="' + id + '">' + esc(label) +
      '<input id="' + id + '" data-path="' + esc(path) + '"' + (extra && extra.type ? ' data-type="' + extra.type + '"' : "") +
      (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : "") + ' value="' + esc(value == null ? "" : value) + '"></label>';
  }

  function editorHtml(m) {
    const idx = M.index(m);
    let h = '<div class="ed-sec"><h3>Rezept</h3><div class="ed-fields">' +
      field("Titel", "f-title", "title", m.title, { cls: "wide" }) +
      field("Zeitangabe", "f-time", "statedTime", m.statedTime) +
      field("Portionen", "f-serv", "servings", m.servings || "", { type: "num" }) + "</div></div>";

    h += '<div class="ed-sec"><h3>Zutaten <span class="count">' + m.ingredients.length + '</span></h3><div class="ed-list">';
    m.ingredients.forEach((z, i) => {
      h += '<div class="ed-ing" data-ing="' + esc(z.id) + '"><div class="ed-row">' +
        '<input id="' + fid("z", z.id, "qty") + '" data-path="ingredients.' + i + '.qty" data-type="qty" value="' + esc(fmtQtyEdit(z.qty)) + '" placeholder="Menge" aria-label="Menge">' +
        '<input id="' + fid("z", z.id, "unit") + '" data-path="ingredients.' + i + '.unit" value="' + esc(z.unit) + '" placeholder="Einheit" aria-label="Einheit">' +
        '<input id="' + fid("z", z.id, "name") + '" data-path="ingredients.' + i + '.name" data-relabel="1" value="' + esc(z.name) + '" placeholder="Zutat" aria-label="Zutat">' +
        '<button type="button" class="x-btn" data-act="del-ing" data-i="' + i + '" aria-label="Zutat entfernen">×</button>' +
        '<input class="note-in" id="' + fid("z", z.id, "note") + '" data-path="ingredients.' + i + '.note" value="' + esc(z.note) + '" placeholder="Notiz" aria-label="Notiz">' +
        '<label class="opt" for="' + fid("z", z.id, "opt") + '"><input type="checkbox" id="' + fid("z", z.id, "opt") + '" data-path="ingredients.' + i + '.optional" data-type="bool"' + (z.optional ? " checked" : "") + '> optional</label>' +
        "</div></div>";
    });
    h += '</div><button type="button" class="btn ghost add-btn" data-act="add-ing">+ Zutat</button></div>';

    h += '<div class="ed-sec"><h3>Geräte <span class="count">' + m.equipment.length + '</span></h3><div class="ed-list">';
    m.equipment.forEach((g, i) => {
      h += '<div class="ed-row eq-row" data-ing="' + esc(g.id) + '">' +
        '<input id="' + fid("g", g.id, "name") + '" data-path="equipment.' + i + '.name" data-relabel="1" value="' + esc(g.name) + '" aria-label="Gerät">' +
        '<input id="' + fid("g", g.id, "note") + '" data-path="equipment.' + i + '.note" value="' + esc(g.note) + '" placeholder="Notiz" aria-label="Notiz">' +
        '<button type="button" class="x-btn" data-act="del-eq" data-i="' + i + '" aria-label="Gerät entfernen">×</button></div>';
    });
    h += '</div><button type="button" class="btn ghost add-btn" data-act="add-eq">+ Gerät</button></div>';

    h += '<div class="ed-sec"><h3>Schritte <span class="count">' + m.steps.length + "</span></h3>";
    m.steps.forEach((s, i) => {
      h += '<article class="step-card' + (s.passive ? " passive" : "") + '" id="card-' + esc(s.id) + '" data-step="' + esc(s.id) + '">' +
        '<div class="step-head"><span class="num">' + (i + 1) + "</span>" +
        '<input class="verb" id="' + fid("s", s.id, "verb") + '" data-path="steps.' + i + '.verb" data-relabel="1" value="' + esc(s.verb) + '" aria-label="Verb" placeholder="Verb, z. B. verrühren">' +
        '<button type="button" class="x-btn" data-act="up" data-i="' + i + '" aria-label="Nach oben"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button type="button" class="x-btn" data-act="down" data-i="' + i + '" aria-label="Nach unten"' + (i === m.steps.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button type="button" class="x-btn" data-act="del-step" data-i="' + i + '" aria-label="Schritt entfernen">×</button></div>';
      h += '<div class="chips">';
      s.inputs.forEach((inp, j) => {
        const e = idx.byId.get(inp.ref);
        const kind = e ? e.kind : "ingredient";
        h += '<span class="chip k-' + kind + '"' + (kind === "step" ? ' data-step="' + esc(inp.ref) + '"' : ' data-ing="' + esc(inp.ref) + '"') + '><span class="chip-l">' + esc(M.refLabel(m, inp.ref, idx)) + "</span>" +
          '<input id="' + fid("s", s.id, "in", j) + '" data-path="steps.' + i + ".inputs." + j + '.portion" value="' + esc(inp.portion) + '" placeholder="Anteil" aria-label="Anteil">' +
          '<button type="button" class="x-btn" data-act="del-input" data-i="' + i + '" data-j="' + j + '" aria-label="Eingang entfernen">×</button></span>';
      });
      h += '<select id="' + fid("s", s.id, "add") + '" data-act="add-input" data-i="' + i + '" aria-label="Eingang hinzufügen"><option value="">+ Eingang …</option>';
      if (m.ingredients.length) h += '<optgroup label="Zutaten">' + m.ingredients.map((z) => '<option value="' + esc(z.id) + '">' + esc(z.name) + ((idx.consumers.get(z.id) || []).length ? " (schon verwendet)" : "") + "</option>").join("") + "</optgroup>";
      if (m.equipment.length) h += '<optgroup label="Geräte">' + m.equipment.map((g) => '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>").join("") + "</optgroup>";
      const earlier = m.steps.slice(0, i);
      if (earlier.length) h += '<optgroup label="Zwischenergebnisse">' + earlier.map((t, k) => '<option value="' + esc(t.id) + '">#' + (k + 1) + " " + esc(M.productLabel(m, t, idx)) + ((idx.consumers.get(t.id) || []).length ? " (schon verwendet)" : "") + "</option>").join("") + "</optgroup>";
      h += "</select></div>";
      h += '<div class="step-grid">' +
        field("Detail", fid("s", s.id, "detail"), "steps." + i + ".detail", s.detail, { ph: "z. B. 2–3 mm Scheiben" }) +
        field("Dauer in Minuten", fid("s", s.id, "dur"), "steps." + i + ".dur", fmtDurEdit(s.dur), { type: "dur", ph: "z. B. 35–40" }) +
        field("Temperatur", fid("s", s.id, "temp"), "steps." + i + ".temp", s.temp, { ph: "z. B. 180 °C" }) +
        field("Wiederholen", fid("s", s.id, "rep"), "steps." + i + ".repeat", s.repeat, { ph: "z. B. 3–4" }) +
        field("Fertig, wenn …", fid("s", s.id, "cue"), "steps." + i + ".cue", s.cue, { cls: "wide", ph: "z. B. goldbraun" }) +
        field("Hinweis (Fußnote)", fid("s", s.id, "note"), "steps." + i + ".note", s.note, { cls: "wide" }) +
        field("Ergebnis heißt", fid("s", s.id, "prod"), "steps." + i + ".product", s.product, { ph: "z. B. Teig" }) +
        '<label class="f check" for="' + fid("s", s.id, "pass") + '"><input type="checkbox" id="' + fid("s", s.id, "pass") + '" data-path="steps.' + i + '.passive" data-type="bool"' + (s.passive ? " checked" : "") + "> Wartezeit, Hände frei</label>" +
        "</div>" + (s.src ? '<p class="src-quote">„' + esc(s.src) + "“</p>" : "") + "</article>";
    });
    h += '<button type="button" class="btn ghost add-btn" data-act="add-step">+ Schritt</button></div>';
    return h;
  }

  function renderEditor() {
    const el = $("#panel-struct");
    if (!S.model) { el.innerHTML = '<div class="empty-card"><p>Erst ein Rezept umwandeln.</p></div>'; return; }
    const act = document.activeElement;
    const focusId = act && el.contains(act) ? act.id : null;
    let sel = null;
    try { if (focusId && act.selectionStart != null) sel = [act.selectionStart, act.selectionEnd]; } catch (e) { sel = null; }
    const scroll = el.scrollTop;
    el.innerHTML = editorHtml(S.model);
    el.scrollTop = scroll;
    if (focusId) {
      const f = document.getElementById(focusId);
      if (f) { f.focus({ preventScroll: true }); try { if (sel) f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* kein Textfeld */ } }
    }
  }

  function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { o = o[/^\d+$/.test(keys[i]) ? +keys[i] : keys[i]]; if (o == null) return; }
    o[keys[keys.length - 1]] = value;
  }

  function readValue(t) {
    const type = t.dataset.type;
    if (type === "bool") return t.checked;
    if (type === "num") { const v = parseFloat(String(t.value).replace(",", ".")); return isFinite(v) && v > 0 ? v : null; }
    if (type === "qty") return M.parseQty(t.value);
    if (type === "dur") return M.normDur(t.value);
    return t.value;
  }

  let viewTimer = 0;
  function scheduleViews() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => { save(); renderHeader(); renderView(); renderBelow(); }, 160);
  }

  function onEditorInput(e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.path || !S.model) return;
    const prevServ = S.model.servings;
    setPath(S.model, t.dataset.path, readValue(t));
    if (t.dataset.path === "servings" && (!S.servings || S.servings === prevServ)) S.servings = S.model.servings;
    if (t.dataset.path.endsWith(".passive")) { const card = t.closest(".step-card"); if (card) card.classList.toggle("passive", t.checked); }
    markManual();
    scheduleViews();
  }

  function onEditorChange(e) {
    const t = e.target;
    if (t.dataset.act === "add-input") {
      const i = +t.dataset.i, ref = t.value;
      if (ref && S.model.steps[i] && !S.model.steps[i].inputs.some((x) => x.ref === ref)) {
        S.model.steps[i].inputs.push({ ref, portion: "" });
        markManual(); afterModelChange(true);
      } else t.value = "";
      return;
    }
    if (t.dataset.relabel) { renderEditor(); }
  }

  function removeRefs(m, ref) {
    for (const s of m.steps) s.inputs = s.inputs.filter((x) => x.ref !== ref);
  }

  function onEditorClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b || !S.model) return;
    const m = S.model, i = +b.dataset.i;
    let focus = null;
    switch (b.dataset.act) {
      case "add-ing": { const id = M.newId(m, "z"); m.ingredients.push({ id, qty: null, unit: "", name: "", note: "", optional: false, missing: false, line: "" }); focus = fid("z", id, "name"); break; }
      case "del-ing": { const z = m.ingredients[i]; if (!z) return; m.ingredients.splice(i, 1); removeRefs(m, z.id); break; }
      case "add-eq": { const id = M.newId(m, "g"); m.equipment.push({ id, name: "", note: "" }); focus = fid("g", id, "name"); break; }
      case "del-eq": { const g = m.equipment[i]; if (!g) return; m.equipment.splice(i, 1); removeRefs(m, g.id); break; }
      case "add-step": {
        const id = M.newId(m, "s");
        const idx = M.index(m);
        const open = m.steps.slice().reverse().find((s) => !(idx.consumers.get(s.id) || []).length);
        m.steps.push({ id, verb: "", detail: "", inputs: open ? [{ ref: open.id, portion: "" }] : [], dur: null, temp: "", passive: false, repeat: "", cue: "", note: "", product: "", src: "", srcStep: null, srcRange: null });
        focus = fid("s", id, "verb");
        break;
      }
      case "del-step": {
        const s = m.steps[i]; if (!s) return;
        m.steps.splice(i, 1);
        // Verbraucher übernehmen die Eingänge des gelöschten Schritts
        for (const t of m.steps) {
          const k = t.inputs.findIndex((x) => x.ref === s.id);
          if (k < 0) continue;
          const repl = s.inputs.filter((x) => !t.inputs.some((y) => y.ref === x.ref));
          t.inputs.splice(k, 1, ...repl);
        }
        break;
      }
      case "up": case "down": {
        const j = b.dataset.act === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= m.steps.length) return;
        [m.steps[i], m.steps[j]] = [m.steps[j], m.steps[i]];
        focus = b.id || null;
        break;
      }
      case "del-input": { const s = m.steps[i]; if (!s) return; s.inputs.splice(+b.dataset.j, 1); break; }
      default: return;
    }
    markManual();
    afterModelChange(true);
    if (focus) { const f = document.getElementById(focus); if (f) { f.focus(); } }
  }

  // ---- Hervorheben & Springen -----------------------------------------------------------------
  let hl = null;
  function clearHl() { $$(".hl").forEach((e) => e.classList.remove("hl")); hl = null; }
  function setHl(kind, id) {
    if (hl && hl.kind === kind && hl.id === id) return;
    clearHl();
    if (!id) return;
    hl = { kind, id };
    const sel = "[data-" + kind + '="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
    $$(sel).forEach((e) => e.classList.add("hl"));
  }
  function onHover(e) {
    const t = e.target.closest && e.target.closest("[data-step],[data-ing]");
    if (!t) { if (hl) clearHl(); return; }
    if (t.dataset.step) setHl("step", t.dataset.step); else setHl("ing", t.dataset.ing);
  }

  function openStep(id) {
    showMob("in");
    setLeft("struct");
    const card = document.getElementById("card-" + id);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    const v = card.querySelector("input.verb");
    if (v) v.focus({ preventScroll: true });
  }

  function setLeft(which) {
    S.left = which;
    $$('.pane-in [role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.left === which)));
    $("#panel-text").hidden = which !== "text";
    $("#panel-struct").hidden = which !== "struct";
    if (which === "struct") renderEditor();
    save();
  }

  function setView(v) {
    S.view = v;
    renderView(); renderBelow(); save();
  }

  /** Handy und Tablet hochkant: Rezept oder Karte im Vollbild. */
  function showMob(which) {
    S.mob = which;
    $(".work").dataset.mob = which;
    $$(".mob-switch [data-mob]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mob === which)));
    if (which === "out") applyZoom();
    save();
  }
  function showMobScrolled(which) {
    const was = S.mob;
    showMob(which);
    if (was !== which && narrow()) {
      const nav = $(".mob-switch");
      if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: "start" });
    }
  }

  // ---- Export ------------------------------------------------------------------------------------
  const slug = (s) => (String(s || "rezept").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "rezept");

  async function saveFile(filename, data, mime) {
    if (S.downloads) {
      try { await S.downloads.save({ filename, data }); toast("Gespeichert: " + filename); }
      catch (e) { if (e && e.code !== "declined") toast(e && e.code === "rate_limited" ? "Bitte kurz warten und erneut versuchen." : "Speichern ist hier nicht möglich."); }
      return;
    }
    if (!S.inArtifact) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: mime }));
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    setView("json");
    toast("Speichern ist in dieser Ansicht nicht verfügbar. Der Inhalt steht in der JSON-Ansicht zum Kopieren.");
  }

  function exportJson() {
    if (!S.model) return;
    saveFile(slug(S.model.title) + ".flusskarte.json", JSON.stringify(exportModel(S.model), null, 2), "application/json");
  }
  function exportHtml() {
    if (!S.model) return;
    const L = FK.theme.light();
    const colors = S.pdf.bw ? null : { grid: L.grid, accent: L.accent, muted: L.muted, ink: L.ink, heat: L.heat, wait: L.wait, "wait-bg": L["wait-bg"], warn: L.warn };
    saveFile(slug(S.model.title) + "-flusskarte.html", R.standaloneHtml(S.model, { servings: S.servings || S.model.servings, colors }), "text/html");
  }

  async function copyText(text, fallbackEl, done) {
    try { await navigator.clipboard.writeText(text); toast(done || "Kopiert"); }
    catch (e) {
      if (fallbackEl) {
        const details = fallbackEl.closest("details");
        if (details) details.open = true;
        fallbackEl.focus(); fallbackEl.select();
        try { if (document.execCommand("copy")) { toast(done || "Kopiert"); return; } } catch (x) { /* weiter */ }
      }
      toast("Bitte markierten Text selbst kopieren");
    }
  }

  function applyJson(text) {
    const err = $("#json-err");
    try {
      const raw = JSON.parse(text);
      const m = M.normalize(raw);
      if (!m.ingredients.length && !m.steps.length) throw new Error("Keine Zutaten oder Schritte gefunden.");
      const src = typeof raw.source === "string" && raw.source ? raw.source : S.text;
      FK.ai.attachSource(m, src);
      if (err) err.textContent = "";
      adopt(m, "import", src, "JSON übernommen");
    } catch (e) {
      if (err) err.textContent = "Das JSON konnte nicht gelesen werden: " + (e && e.message ? e.message : "unbekannter Fehler");
    }
  }

  let toastTimer = 0;
  function toast(text, action) {
    const t = $("#toast");
    t.textContent = "";
    t.append(document.createTextNode(text));
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "toast-act"; b.textContent = action.label;
      b.addEventListener("click", () => { t.hidden = true; action.run(); });
      t.append(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3200);
  }

  // ---- Dialoge ---------------------------------------------------------------------------------------
  function openDlg(id) {
    const d = document.getElementById(id);
    closeMenu();
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    return d;
  }
  function closeDlg(d) {
    if (!d) return;
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  // Teilen
  let shareSeq = 0;
  async function refreshShare() {
    if (!S.model) return;
    const seq = ++shareSeq;
    const code = await FK.share.encode(S.model, { withSource: S.shareSrc });
    if (seq !== shareSeq) return;
    $("#share-code").value = code;
    $("#share-size").textContent = code.length.toLocaleString("de-DE") + " Zeichen";
    const link = FK.share.linkFor(code);
    $("#share-link").hidden = !link;
    $("#share-native").hidden = !navigator.share;
  }
  function openShare() {
    if (!S.model) { toast("Erst ein Rezept umwandeln"); return; }
    $("#share-src").checked = S.shareSrc;
    $("#share-err").textContent = "";
    $("#share-code").value = "";
    openDlg("dlg-share");
    refreshShare().catch(() => { $("#share-err").textContent = "Der Code konnte nicht erzeugt werden."; });
  }
  async function shareNative() {
    const code = $("#share-code").value;
    const link = FK.share.linkFor(code);
    try {
      await navigator.share(link ? { title: S.model.title, text: "Rezept-Flusskarte: " + S.model.title, url: link } : { title: S.model.title, text: code });
    } catch (e) { /* abgebrochen */ }
  }

  // KI
  function openAi() {
    $("#ai-err").textContent = "";
    $("#ai-prompt").value = FK.ai.promptFor(S.text);
    openDlg("dlg-ai");
  }
  function applyAi() {
    const err = $("#ai-err");
    try {
      const raw = FK.ai.extract($("#ai-answer").value);
      const m = M.normalize(raw);
      if (!m.steps.length) throw new Error("Die Antwort enthält keine Arbeitsschritte.");
      // Rezepttext in Standardform aus der Antwort ersetzt das Eingabefeld
      const fresh = !!m.source;
      const src = m.source || S.text;
      FK.ai.attachSource(m, src);
      err.textContent = "";
      $("#ai-answer").value = "";
      closeDlg($("#dlg-ai"));
      setLeft("text");
      adopt(m, "ai", src, fresh ? "Karte und Rezepttext aus der KI-Antwort übernommen" : "Karte aus der KI-Antwort übernommen");
    } catch (e) {
      err.textContent = e && e.message ? e.message : "Die Antwort konnte nicht gelesen werden.";
    }
  }

  // PDF
  function syncPdfDlg() {
    $$("#dlg-pdf [data-opt]").forEach((i) => { i.checked = !!S.pdf[i.dataset.opt]; });
    $$("#dlg-pdf [data-orient]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.orient === S.pdf.orient)));
    $("#pdf-go").disabled = !["card", "notes", "timeline", "lint", "original"].some((k) => S.pdf[k]);
  }
  function openPdf() {
    if (!S.model) { toast("Erst ein Rezept umwandeln"); return; }
    syncPdfDlg();
    openDlg("dlg-pdf");
  }
  function makePdf() {
    closeDlg($("#dlg-pdf"));
    const ok = FK.print.print(S.model, S.servings || S.model.servings, S.pdf);
    if (!ok) toast("Drucken ist in dieser Ansicht nicht möglich. Bitte die Seite direkt im Browser öffnen.");
  }

  // Menü „Mehr“
  function closeMenu() {
    const pop = $("#menu-more");
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    $("#btn-more").setAttribute("aria-expanded", "false");
  }
  function toggleMenu() {
    const pop = $("#menu-more");
    const open = pop.hidden;
    pop.hidden = !open;
    $("#btn-more").setAttribute("aria-expanded", String(open));
    if (open) { const first = pop.querySelector("button"); if (first) first.focus(); }
  }
  function onMenu(act) {
    closeMenu();
    if (act === "ai") openAi();
    else if (act === "sample") loadSample();
    else if (act === "json") exportJson();
    else if (act === "html") exportHtml();
  }

  function loadSample() {
    S.text = SAMPLE; $("#src").value = SAMPLE; S.done = []; setLeft("text"); convertLocal(); toast("Beispiel geladen");
  }

  // ---- Start ---------------------------------------------------------------------------------------
  let parseTimer = 0, confirmTimer = 0, confirmArmed = false;

  function bind() {
    const src = $("#src");
    src.addEventListener("input", () => {
      // eingefügter Rezept-Code oder Link mit Code: direkt laden
      if (FK.share.isCodeOnly(src.value)) {
        const pasted = src.value;
        src.value = S.text;
        loadCode(pasted).catch((e) => { src.value = pasted; S.text = pasted; setStatus(e.message, true); });
        return;
      }
      S.text = src.value;
      if (S.origin === "local") { clearTimeout(parseTimer); parseTimer = setTimeout(convertLocal, 350); }
      else { S.staleText = true; renderStatus(); }
      save();
    });
    $("#btn-local").addEventListener("click", () => {
      const btn = $("#btn-local");
      if (S.origin !== "local" && !confirmArmed && S.model) {
        confirmArmed = true;
        btn.textContent = "Bearbeitung verwerfen?";
        btn.classList.add("danger");
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { confirmArmed = false; btn.textContent = "Umwandeln"; btn.classList.remove("danger"); }, 4000);
        return;
      }
      confirmArmed = false; clearTimeout(confirmTimer);
      btn.textContent = "Umwandeln"; btn.classList.remove("danger");
      S.text = src.value;
      convertLocal();
      showMobScrolled("out");
    });
    $("#btn-ai").addEventListener("click", () => { S.text = src.value; openAi(); });

    // Kopfzeile
    $("#btn-share").addEventListener("click", openShare);
    $("#btn-pdf").addEventListener("click", openPdf);
    $("#btn-theme").addEventListener("click", () => openDlg("dlg-theme"));
    $("#btn-more").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
    $("#menu-more").addEventListener("click", (e) => { const b = e.target.closest("[data-menu]"); if (b) onMenu(b.dataset.menu); });
    $("#menu-more").addEventListener("keydown", (e) => {
      const items = $$("#menu-more button");
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === "Escape") { closeMenu(); $("#btn-more").focus(); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenu(); });

    $$(".mob-switch [data-mob]").forEach((b) => b.addEventListener("click", () => showMob(b.dataset.mob)));

    // Dialoge: Schließen-Knopf und Klick neben das Fenster
    $$("dialog.sheet").forEach((d) => {
      d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) closeDlg(d); });
    });
    FK.theme.mountDialog($("#theme-body"));
    FK.theme.onChange(() => { if (S.view === "flow") applyZoom(); });

    // Teilen
    $("#share-src").addEventListener("change", (e) => { S.shareSrc = e.target.checked; save(); refreshShare(); });
    $("#share-copy").addEventListener("click", () => copyText($("#share-code").value, $("#share-code"), "Code kopiert"));
    $("#share-link").addEventListener("click", () => {
      const link = FK.share.linkFor($("#share-code").value);
      if (link) copyText(link, $("#share-code"), "Link kopiert");
    });
    $("#share-native").addEventListener("click", shareNative);
    $("#share-code").addEventListener("focus", (e) => e.target.select());
    $("#share-load").addEventListener("click", () => {
      const err = $("#share-err");
      err.textContent = "";
      loadCode($("#share-in").value)
        .then(() => { $("#share-in").value = ""; closeDlg($("#dlg-share")); })
        .catch((e) => { err.textContent = e.message; });
    });

    // KI
    $("#ai-copy-recipe").addEventListener("click", () => {
      if (!S.text.trim()) { $("#ai-err").textContent = "Das Textfeld ist leer. Bitte erst ein Rezept einfügen oder die Formatanleitung kopieren."; return; }
      $("#ai-prompt").value = FK.ai.promptFor(S.text);
      copyText($("#ai-prompt").value, $("#ai-prompt"), "Prompt mit Rezept kopiert");
    });
    $("#ai-copy-generic").addEventListener("click", () => {
      $("#ai-prompt").value = FK.ai.GENERIC;
      copyText(FK.ai.GENERIC, $("#ai-prompt"), "Formatanleitung kopiert");
    });
    $("#ai-apply").addEventListener("click", applyAi);

    // PDF
    $("#dlg-pdf").addEventListener("change", (e) => {
      const k = e.target.dataset && e.target.dataset.opt;
      if (!k) return;
      S.pdf[k] = e.target.checked; save(); syncPdfDlg();
    });
    $("#dlg-pdf").addEventListener("click", (e) => {
      const b = e.target.closest("[data-orient]");
      if (b) { S.pdf.orient = b.dataset.orient; save(); syncPdfDlg(); }
    });
    $("#pdf-go").addEventListener("click", makePdf);
    window.addEventListener("beforeprint", () => FK.print.beforePrint(S.model, S.servings || (S.model && S.model.servings), S.pdf));

    const sv = $("#sv");
    const setServ = (v) => {
      if (!S.model || !S.model.servings) return;
      v = Math.max(1, Math.min(99, Math.round(v) || S.model.servings));
      S.servings = v; renderHeader(); renderView(); renderBelow(); save();
    };
    $("#sv-minus").addEventListener("click", () => setServ((S.servings || S.model.servings) - 1));
    $("#sv-plus").addEventListener("click", () => setServ((S.servings || S.model.servings) + 1));
    sv.addEventListener("change", () => setServ(parseFloat(sv.value)));

    $$('.pane-in [role="tab"]').forEach((t) => t.addEventListener("click", () => setLeft(t.dataset.left)));
    $$('.pane-out [role="tab"]').forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));

    const ed = $("#panel-struct");
    ed.addEventListener("input", onEditorInput);
    ed.addEventListener("change", onEditorChange);
    ed.addEventListener("click", onEditorClick);

    document.addEventListener("mouseover", onHover);
    document.addEventListener("focusin", onHover);
    const view = $("#view");
    view.addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]");
      if (z) {
        if (z.dataset.zoom === "fit") { S.zoom = S.zoom === "fit" ? 1 : "fit"; applyZoom(); save(); }
        else stepZoom(+z.dataset.zoom);
        return;
      }
      const tm = e.target.closest(".tmr[data-timer]");
      if (tm) { startTimer(tm.dataset.timer); return; }
      const ck = e.target.closest("[data-cook]");
      if (ck) {
        if (ck.dataset.cook === "hide") S.hideDone = !S.hideDone;
        else {
          const prev = S.done;
          S.done = [];
          toast("Alle Haken entfernt", { label: "Rückgängig", run: () => { S.done = prev; save(); renderView(); } });
        }
        save(); renderView();
        return;
      }
      const op = e.target.closest("td.op[data-step], .tl-row[data-step], td.done-row[data-step]");
      if (op) { setDone(op.dataset.step); return; }
      const act = e.target.closest("button[data-act]");
      if (act && act.dataset.act === "json-copy") copyText($("#json-edit").value, $("#json-edit"));
      if (act && act.dataset.act === "json-apply") applyJson($("#json-edit").value);
    });
    // Doppelklick: die ersten beiden Klicks haben den Haken hin und zurück gesetzt
    view.addEventListener("dblclick", (e) => {
      const op = e.target.closest("td.op[data-step]");
      if (op && !e.target.closest(".tmr")) openStep(op.dataset.step);
    });
    view.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("td.op[data-step], .tl-row[data-step]")) {
        e.preventDefault();
        setDone(e.target.dataset.step);
      }
    });
    view.addEventListener("change", (e) => {
      if (e.target.id !== "json-file" || !e.target.files || !e.target.files[0]) return;
      const fr = new FileReader();
      fr.onload = () => { $("#json-edit").value = String(fr.result || ""); applyJson(String(fr.result || "")); };
      fr.readAsText(e.target.files[0]);
    });
    $("#below").addEventListener("click", (e) => {
      const li = e.target.closest("ul.lint li[data-step]");
      if (li) openStep(li.dataset.step);
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.zoom === "fit") applyZoom(); }, 120); });
    window.addEventListener("hashchange", importFromHash);
  }

  /** Link mit #fk=… geöffnet: Rezept laden und das Fragment entfernen. */
  function importFromHash() {
    const code = FK.share.fromHash(location.hash);
    if (!code) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* egal */ }
    loadCode(code).catch((e) => setStatus(e.message, true));
  }

  async function initCapabilities() {
    if (!S.inArtifact) return;
    try {
      const dl = await window.claude.use("downloads");
      if (dl) S.downloads = dl;
    } catch (e) { /* nicht verfügbar */ }
    $("#menu-html").hidden = !S.downloads;
  }

  function registerWorker() {
    // offline nutzbar, wenn über https ausgeliefert (GitHub Pages); lokal und im Artefakt nicht
    if (S.inArtifact || location.protocol !== "https:" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(() => { /* ohne Offline-Modus weiter */ });
  }

  function start() {
    const restored = load();
    if (!restored) { S.text = SAMPLE; }
    $("#src").value = S.text;
    bind();
    FK.kitchen.init($("#timers"), { onDone: (id) => setDone(id, true) });
    if (!S.model) { S.model = FK.parse(S.text); S.origin = "local"; S.servings = S.model.servings; }
    setLeft(S.left);
    showMob(S.mob);
    renderHeader(); renderView(); renderBelow(); renderStatus();
    initCapabilities();
    importFromHash();
    registerWorker();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window.FK = window.FK || {});
