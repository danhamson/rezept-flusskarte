/* Flusskarte – PDF über den Druckdialog des Browsers („Als PDF speichern“).
 * Baut eine eigene Druckseite (A4, quer oder hoch) und passt die Karte auf die Seitenbreite
 * oder auf eine ganze Seite ein. Text bleibt Text: das PDF ist scharf und durchsuchbar.
 */
(function (FK) {
  "use strict";
  const R = FK.render, M = FK.model, esc = FK.render.esc;
  const PAGE = { landscape: [297, 210], portrait: [210, 297] };
  const MARGIN = 10;
  const px = (mm) => mm * 96 / 25.4;
  const DEFAULTS = { card: true, notes: true, timeline: false, lint: false, original: false, orient: "landscape", fit: true, bw: false };

  let fresh = false;

  function root() {
    let el = document.getElementById("print-root");
    if (!el) { el = document.createElement("div"); el.id = "print-root"; document.body.appendChild(el); }
    return el;
  }

  function pageStyle(orient) {
    let st = document.getElementById("print-page");
    if (!st) { st = document.createElement("style"); st.id = "print-page"; document.head.appendChild(st); }
    st.textContent = "@page{size:A4 " + orient + ";margin:" + MARGIN + "mm}";
  }

  function html(m, servings, o) {
    const meta = [m.servings ? M.fmtNum(servings || m.servings) + " Portionen" : "", m.statedTime].filter(Boolean).join(" · ");
    let h = '<header class="pr-head"><div><h1>' + esc(m.title) + "</h1>" + (meta ? '<p class="pr-meta">' + esc(meta) + "</p>" : "") + '</div><p class="pr-brand">Rezept-Flusskarte</p></header>';
    if (o.card) {
      h += '<section class="pr-card"><div class="pr-fit">' + R.flowCard(m, { servings }).html + "</div>" +
        '<p class="pr-legend"><span><span class="sw-pass"></span> Wartezeit, Hände frei</span><span><span class="tag tag-split">Teil 1/2</span> aufgeteilte Zutat</span><span>✓ fertig, wenn …</span><span>→ Zwischenprodukt</span></p></section>';
    }
    const extra = [];
    if (o.notes) {
      const notes = R.notesOf(m);
      if (notes.length) extra.push('<section class="pr-box"><h3>Anmerkungen</h3><ol class="notes">' + notes.map((n) => "<li>" + esc(n.text) + ' <span class="ref">(Schritt ' + (n.order + 1) + ")</span></li>").join("") + "</ol></section>");
      const layers = R.layerHtml(m, R.factorOf(m, servings));
      if (layers) extra.push('<section class="pr-box">' + layers + "</section>");
    }
    if (o.lint) {
      const items = M.lint(m).concat(m.lint || []);
      extra.push('<section class="pr-box"><h3>Prüfung des Rezepts</h3>' + (items.length
        ? '<ul class="lint">' + items.map((l) => '<li class="' + esc(l.level) + '"><span class="lv">' + ({ warn: "Achtung", error: "Fehler" }[l.level] || "Hinweis") + "</span><span>" + esc(l.text) + "</span></li>").join("") + "</ul>"
        : '<p class="ok">Keine Lücken gefunden.</p>') + "</section>");
    }
    if (extra.length) h += '<div class="pr-extra">' + extra.join("") + "</div>";
    if (o.timeline) h += '<section class="pr-page pr-tl"><h2>Zeitplan</h2>' + R.timelineHtml(m) + "</section>";
    if (o.original && m.source && m.source.trim()) h += '<section class="pr-page pr-orig"><h2>Originalrezept</h2><div class="original">' + esc(m.source) + "</div></section>";
    h += '<footer class="pr-foot">Erstellt mit Rezept-Flusskarte · ' + esc(new Date().toLocaleDateString("de-DE")) + "</footer>";
    return h;
  }

  /** Druckseite aufbauen und die Karte einpassen. */
  function prepare(m, servings, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const el = root();
    const [w, hgt] = PAGE[o.orient] || PAGE.landscape;
    const availW = px(w - 2 * MARGIN), availH = px(hgt - 2 * MARGIN);
    pageStyle(o.orient === "portrait" ? "portrait" : "landscape");
    el.className = "pr" + (o.bw ? " bw" : "");
    el.innerHTML = html(m, servings, o);
    // unsichtbar in Seitenbreite messen
    el.classList.add("measuring");
    el.style.width = availW + "px";
    const fit = el.querySelector(".pr-fit");
    const table = fit && fit.querySelector("table");
    if (table) {
      table.style.zoom = "";
      const tw = table.offsetWidth, th = table.offsetHeight;
      const head = el.querySelector(".pr-head").offsetHeight + el.querySelector(".pr-legend").offsetHeight + 24;
      let z = Math.min(1, availW / Math.max(tw, 1));
      if (o.fit) z = Math.min(z, (availH - head) / Math.max(th, 1));
      z = Math.max(0.3, z);
      if (z < 0.999) table.style.zoom = z.toFixed(3);
    }
    el.classList.remove("measuring");
    el.style.width = "";
    fresh = true;
    return o;
  }

  function print(m, servings, opts) {
    prepare(m, servings, opts);
    try { window.print(); return true; } catch (e) { return false; }
  }

  window.addEventListener("afterprint", () => { fresh = false; });

  FK.print = {
    DEFAULTS, prepare, print,
    /** Für Strg+P ohne Dialog: Druckseite mit gespeicherten Einstellungen auffrischen. */
    beforePrint(m, servings, opts) { if (!fresh && m) prepare(m, servings, opts); }
  };
})(window.FK = window.FK || {});
