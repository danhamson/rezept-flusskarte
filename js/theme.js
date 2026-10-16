/* Flusskarte – Darstellung: Farbschemata, eigene Farben, Hell/Dunkel.
 * Wird im <head> geladen und setzt die Farben vor dem ersten Zeichnen, damit nichts aufblitzt.
 * Aus drei Grundfarben (Linien, Akzent, Hintergrund) entstehen alle Variablen für Hell und Dunkel;
 * Text- und Linienfarben werden nachgedunkelt oder aufgehellt, bis der Kontrast reicht.
 */
(function (FK) {
  "use strict";
  const STORE = "flusskarte.theme";

  // ---- Farbrechnung ---------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function hexToRgb(hex) {
    let h = String(hex || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgbToHex = (rgb) => "#" + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
  }
  function hslToRgb({ h, s, l }) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const hsl = (hex) => rgbToHsl(hexToRgb(hex) || [0, 0, 0]);
  const fromHsl = (h, s, l) => rgbToHex(hslToRgb({ h, s: clamp(s, 0, 1), l: clamp(l, 0, 1) }));
  function lum(hex) {
    const c = (hexToRgb(hex) || [0, 0, 0]).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function mix(a, b, t) {
    const x = hexToRgb(a) || [0, 0, 0], y = hexToRgb(b) || [0, 0, 0];
    return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
  }
  /** Helligkeit schrittweise verschieben, bis der Kontrast zum Hintergrund reicht. */
  function ensure(color, bg, ratio) {
    if (contrast(color, bg) >= ratio) return color;
    const c = hsl(color);
    const darker = lum(bg) > 0.18;
    for (let i = 1; i <= 50; i++) {
      const l = c.l + (darker ? -0.02 : 0.02) * i;
      const out = fromHsl(c.h, c.s, l);
      if (contrast(out, bg) >= ratio || l <= 0 || l >= 1) return out;
    }
    return darker ? "#000000" : "#ffffff";
  }

  // ---- Feste Farben (Hitze, Warten, Warnungen, Schichtplan) -----------------------------------------
  const FIXED_LIGHT = {
    heat: "#a8520f", wait: "#46698b", "wait-bg": "#e3ebf3", warn: "#8f5200", "warn-bg": "#fdf1d8", error: "#b3261e", hl: "#fbeea0",
    l1: "#e7c35a", l2: "#c3b0dc", l3: "#f1e6bd", l4: "#a8c7de", l5: "#b9d2a3", l6: "#e2b29a"
  };
  const FIXED_DARK = {
    heat: "#f0a25a", wait: "#93b4d4", "wait-bg": "#1c2733", warn: "#f1b75c", "warn-bg": "#30250f", error: "#ff8a80", hl: "#4d4520",
    l1: "#9c7f25", l2: "#6c5a8a", l3: "#7b7350", l4: "#3f6680", l5: "#55704a", l6: "#8a5a44"
  };

  // ---- Farbschemata -------------------------------------------------------------------------------
  const PRESETS = [
    { id: "gruen", name: "Tabellengrün", grid: "#3f9a47", accent: "#2c7a35", paper: "#f2f5f0",
      light: { paper: "#f2f5f0", panel: "#ffffff", "panel-2": "#f7f9f6", ink: "#17221c", muted: "#5b6a61", rule: "#cdd6cf", grid: "#3f9a47", accent: "#2c7a35", "accent-ink": "#ffffff" },
      dark: { paper: "#101613", panel: "#161e19", "panel-2": "#1b241e", ink: "#e1e9e3", muted: "#97a69c", rule: "#2d3a31", grid: "#4fae58", accent: "#62c46c", "accent-ink": "#0b130d" } },
    { id: "tinte", name: "Tinte", grid: "#2f64b0", paper: "#eff3f8" },
    { id: "petrol", name: "Petrol", grid: "#13807c", paper: "#edf5f4" },
    { id: "tomate", name: "Tomate", grid: "#c4453a", paper: "#f8f1ee" },
    { id: "himbeere", name: "Himbeere", grid: "#bd3a6c", paper: "#f9eff3" },
    { id: "aubergine", name: "Aubergine", grid: "#7b4a9e", paper: "#f4f0f7" },
    { id: "kupfer", name: "Kupfer", grid: "#b5623a", paper: "#f7efe9" },
    { id: "senf", name: "Senf", grid: "#b08510", paper: "#f7f3e6" },
    { id: "pergament", name: "Pergament", grid: "#8b6b3d", accent: "#7a5a2c", paper: "#f3ead6" },
    { id: "graphit", name: "Graphit", grid: "#50565c", paper: "#f2f2f1" },
    { id: "kontrast", name: "Kontrast", grid: "#111111", accent: "#000000", paper: "#ffffff" }
  ];
  const byId = new Map(PRESETS.map((p) => [p.id, p]));

  /** Alle Variablen aus Linien-, Akzent- und Hintergrundfarbe. */
  function derive(base, dark) {
    const p = hsl(base.paper), g = hsl(base.grid);
    const hue = p.s > 0.06 ? p.h : g.h;
    const tint = clamp(p.s > 0.06 ? p.s : g.s * 0.35, 0, 0.35);
    const t = {};
    if (!dark) {
      t.paper = lum(base.paper) >= 0.55 ? base.paper : fromHsl(hue, Math.min(tint, 0.3), 0.95);
      t.panel = mix(t.paper, "#ffffff", 0.8);
      t["panel-2"] = mix(t.paper, "#ffffff", 0.45);
      t.ink = fromHsl(hue, Math.min(0.22, tint + 0.1), 0.11);
      t.muted = ensure(fromHsl(hue, Math.min(0.1, tint), 0.38), t.paper, 4.6);
      t.rule = mix(t.paper, t.ink, 0.17);
      t.grid = ensure(base.grid, t.panel, 2.4);
      t.accent = ensure(base.accent || base.grid, t.panel, 4.6);
    } else {
      const s = Math.min(0.2, tint * 0.9 + 0.04);
      t.paper = lum(base.paper) < 0.03 ? base.paper : fromHsl(hue, s, 0.075);
      t.panel = mix(t.paper, "#ffffff", 0.035);
      t["panel-2"] = mix(t.paper, "#ffffff", 0.065);
      t.ink = fromHsl(hue, 0.14, 0.9);
      t.muted = ensure(fromHsl(hue, 0.08, 0.62), t.paper, 5);
      t.rule = mix(t.paper, t.ink, 0.17);
      t.grid = ensure(base.grid, t.panel, 3.2);
      t.accent = ensure(base.accent || base.grid, t.panel, 5.2);
    }
    const darkInk = fromHsl(hue, 0.3, 0.06);
    t["accent-ink"] = contrast(t.accent, "#ffffff") >= contrast(t.accent, darkInk) ? "#ffffff" : darkInk;
    return t;
  }

  // ---- Zustand --------------------------------------------------------------------------------
  const DEFAULT = { mode: "auto", preset: "gruen", custom: null };
  let state = load();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!d) return Object.assign({}, DEFAULT);
      const mode = ["auto", "light", "dark"].includes(d.mode) ? d.mode : "auto";
      const custom = d.custom && hexToRgb(d.custom.grid) && hexToRgb(d.custom.paper)
        ? { grid: rgbToHex(hexToRgb(d.custom.grid)), paper: rgbToHex(hexToRgb(d.custom.paper)), accent: hexToRgb(d.custom.accent) ? rgbToHex(hexToRgb(d.custom.accent)) : null }
        : null;
      const preset = d.preset === "custom" && custom ? "custom" : byId.has(d.preset) ? d.preset : "gruen";
      return { mode, preset, custom };
    } catch (e) { return Object.assign({}, DEFAULT); }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* privat oder blockiert */ } }

  function base() {
    if (state.preset === "custom" && state.custom) return state.custom;
    return byId.get(state.preset) || PRESETS[0];
  }
  function tokens(dark) {
    const b = base();
    const own = b[dark ? "dark" : "light"];
    return Object.assign({}, dark ? FIXED_DARK : FIXED_LIGHT, own || derive(b, dark));
  }

  // ---- Anwenden ----------------------------------------------------------------------------------
  const decl = (t) => Object.keys(t).map((k) => "--" + k + ":" + t[k]).join(";");
  function apply() {
    const L = tokens(false), D = tokens(true);
    const css = ":root{" + decl(L) + "}" +
      '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + decl(D) + ";color-scheme:dark}}" +
      ':root[data-theme="dark"]{' + decl(D) + ";color-scheme:dark}" +
      ':root[data-theme="light"]{color-scheme:light}' +
      '@media print{:root,:root:not([data-theme="light"]),:root[data-theme="dark"]{' + decl(L) + ";color-scheme:light}}";
    let el = document.getElementById("fk-theme");
    if (!el) { el = document.createElement("style"); el.id = "fk-theme"; }
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el); // immer zuletzt, damit es styles.css überstimmt
    const root = document.documentElement;
    if (state.mode === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", state.mode);
    // Browserleiste auf Handy und Tablet in der Papierfarbe
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const meta = (content, media) => { const m = document.createElement("meta"); m.name = "theme-color"; m.content = content; if (media) m.media = media; (document.head || root).appendChild(m); };
    if (state.mode === "auto") { meta(L.paper, "(prefers-color-scheme: light)"); meta(D.paper, "(prefers-color-scheme: dark)"); }
    else meta(state.mode === "dark" ? D.paper : L.paper);
  }

  function set(patch) {
    state = Object.assign({}, state, patch);
    save(); apply(); notify();
  }
  const listeners = [];
  const notify = () => listeners.forEach((f) => { try { f(state); } catch (e) { /* weiter */ } });

  /** Ausgangswerte für die Farbwähler: das aktive Schema in hellen Farben. */
  function pickerValues() {
    const b = base(), L = tokens(false);
    return { grid: rgbToHex(hexToRgb(b.grid)), accent: b.accent ? rgbToHex(hexToRgb(b.accent)) : L.accent, accentAuto: !b.accent, paper: L.paper };
  }

  // ---- Dialog -----------------------------------------------------------------------------------
  function swatch(p) {
    const L = p.light || derive(p, false);
    return '<button type="button" class="swatch" data-preset="' + p.id + '" aria-pressed="false">' +
      '<span class="sw-prev" style="--sp:' + L.paper + ";--sg:" + L.grid + ";--sa:" + L.accent + '" aria-hidden="true"></span><span class="sw-name">' + p.name + "</span></button>";
  }

  function mountDialog(el) {
    el.innerHTML =
      '<fieldset class="fs"><legend>Helligkeit</legend><div class="seg" role="group" aria-label="Helligkeit">' +
      '<button type="button" data-mode="auto" aria-pressed="false">Automatisch</button><button type="button" data-mode="light" aria-pressed="false">Hell</button><button type="button" data-mode="dark" aria-pressed="false">Dunkel</button></div></fieldset>' +
      '<fieldset class="fs"><legend>Farbschema</legend><div class="swatches">' + PRESETS.map(swatch).join("") +
      '<button type="button" class="swatch" data-preset="custom" aria-pressed="false"><span class="sw-prev sw-custom" aria-hidden="true"></span><span class="sw-name">Eigene Farben</span></button></div></fieldset>' +
      '<fieldset class="fs"><legend>Eigene Farben</legend><div class="pickers">' +
      '<label class="picker" for="th-grid"><input type="color" id="th-grid" data-key="grid"><span>Linien</span></label>' +
      '<label class="picker" for="th-accent"><input type="color" id="th-accent" data-key="accent"><span>Akzent <small id="th-accent-auto">automatisch</small></span></label>' +
      '<label class="picker" for="th-paper"><input type="color" id="th-paper" data-key="paper"><span>Hintergrund</span></label></div>' +
      '<p class="hint">Eine Farbe ändern genügt, ein Schema ist nicht nötig. Schrift und Kontraste passen sich an. Im dunklen Modus entsteht der Hintergrund aus dem gewählten Farbton.</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="accent-auto">Akzent automatisch</button><button type="button" class="btn ghost" data-act="reset">Zurücksetzen</button></div></fieldset>';

    const sync = () => {
      el.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
      el.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset)));
      const v = pickerValues();
      for (const k of ["grid", "accent", "paper"]) { const i = el.querySelector('[data-key="' + k + '"]'); if (i && document.activeElement !== i) i.value = v[k]; }
      el.querySelector("#th-accent-auto").hidden = !v.accentAuto;
      const c = el.querySelector(".sw-custom");
      const cu = state.custom ? derive(state.custom, false) : null;
      if (c && cu) c.setAttribute("style", "--sp:" + cu.paper + ";--sg:" + cu.grid + ";--sa:" + cu.accent);
    };
    el.addEventListener("click", (e) => {
      const m = e.target.closest("[data-mode]");
      if (m) { set({ mode: m.dataset.mode }); return; }
      const p = e.target.closest("[data-preset]");
      if (p) {
        if (p.dataset.preset === "custom") { const v = pickerValues(); set({ preset: "custom", custom: state.custom || { grid: v.grid, accent: v.accentAuto ? null : v.accent, paper: v.paper } }); }
        else set({ preset: p.dataset.preset });
        return;
      }
      const a = e.target.closest("[data-act]");
      if (a && a.dataset.act === "reset") set(Object.assign({}, DEFAULT));
      if (a && a.dataset.act === "accent-auto") { const v = pickerValues(); set({ preset: "custom", custom: { grid: v.grid, paper: v.paper, accent: null } }); }
    });
    el.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.key;
      if (!k) return;
      const v = pickerValues();
      const custom = { grid: v.grid, accent: v.accentAuto ? null : v.accent, paper: v.paper };
      custom[k] = e.target.value;
      set({ preset: "custom", custom });
    });
    listeners.push(sync);
    sync();
  }

  apply();
  FK.theme = {
    PRESETS, mountDialog, onChange: (f) => listeners.push(f),
    light: () => tokens(false), dark: () => tokens(true),
    get: () => Object.assign({}, state),
    _derive: derive, _contrast: contrast
  };
})(window.FK = window.FK || {});
