/* Flusskarte – Küchentimer: Timer je Schritt, Leiste unten rechts, Alarm mit Ton, Vibration und Mitteilung.
 * Die Endzeit wird gespeichert; nach einem Neuladen oder wenn das Handy kurz gesperrt war, läuft der Timer weiter
 * und klingelt beim Zurückkommen. Solange ein Timer läuft, bleibt der Bildschirm an (wo der Browser das kann).
 */
(function (FK) {
  "use strict";
  const STORE = "flusskarte.timers";
  const RING_MAX = 3 * 60 * 1000; // danach nur noch stilles Blinken
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let timers = []; // { id, step, label, range, ms, end, left, ring }
  let hooks = {}, el = null, tickId = 0, beepId = 0, audio = null, wake = null, seq = 0;

  const now = () => Date.now();
  const remaining = (t) => (t.end ? Math.max(0, t.end - now()) : t.left);
  const running = () => timers.some((t) => t.end && !t.ring);
  const ringing = () => timers.some((t) => t.ring);

  function fmt(ms) {
    const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + p(m) + ":" + p(x) : m + ":" + p(x);
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(timers.map((t) => Object.assign({}, t, { ring: !!t.ring })))); } catch (e) { /* egal */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || "[]");
      if (!Array.isArray(d)) return;
      timers = d.filter((t) => t && t.id && typeof t.ms === "number").map((t) => Object.assign(t, { ring: t.ring ? now() - RING_MAX : 0 }));
      seq = timers.length;
    } catch (e) { timers = []; }
  }

  // ---- Ton ------------------------------------------------------------------------------------
  /** Muss in einem Klick laufen: Mobile Browser geben Ton erst nach einer Bedienung frei. */
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      // stummer Ton, damit auch strenge Mobilbrowser den Kontext wirklich freigeben
      const o = audio.createOscillator(), g = audio.createGain();
      g.gain.value = 0; o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.02);
    } catch (e) { audio = null; }
  }
  function beep() {
    if (!audio) return;
    try {
      if (audio.state === "suspended") audio.resume();
      const t0 = audio.currentTime;
      for (let i = 0; i < 3; i++) {
        const o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * 0.22;
        o.type = "square"; o.frequency.value = i === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + 0.18);
      }
    } catch (e) { /* ohne Ton */ }
    const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    try { if (navigator.vibrate && touched) navigator.vibrate([300, 120, 300, 120, 500]); } catch (e) { /* egal */ }
  }

  function notify(t) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    const body = t.label + (t.range ? " · " + t.range : "");
    const opts = { body, tag: "fk-" + t.id, renotify: true, requireInteraction: true, icon: "icons/icon-192.png" };
    const viaPage = () => { try { new Notification("Timer abgelaufen", opts); } catch (e) { /* manche Mobilbrowser: nur über Service Worker */ } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((r) => r.showNotification("Timer abgelaufen", opts)).catch(viaPage);
    } else viaPage();
  }

  // ---- Bildschirm an lassen -------------------------------------------------------------------------
  async function syncWake() {
    const want = running() && !document.hidden;
    try {
      if (want && !wake && navigator.wakeLock) {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => { wake = null; });
      } else if (!want && wake) { const w = wake; wake = null; await w.release(); }
    } catch (e) { wake = null; }
  }

  // ---- Ablauf -----------------------------------------------------------------------------------------
  function tick() {
    let changed = false;
    for (const t of timers) {
      if (t.end && !t.ring && t.end <= now()) {
        // klingelt ab dem echten Ende; war die Seite lange zu, nur noch still anzeigen
        t.ring = t.end; t.left = 0; changed = true;
        if (now() - t.end < RING_MAX) notify(t);
        if (hooks.onRing) hooks.onRing(t);
      }
    }
    if (changed) { save(); render(); syncWake(); }
    const loud = timers.some((t) => t.ring && now() - t.ring < RING_MAX);
    if (loud && !beepId) { beep(); beepId = setInterval(() => { if (timers.some((t) => t.ring && now() - t.ring < RING_MAX)) beep(); else stopBeep(); }, 1600); }
    if (!loud) stopBeep();
    paint();
    const base = document.title.replace(/^⏰ /, "");
    document.title = ringing() ? "⏰ " + base : base;
    const need = running() || ringing();
    if (need && !tickId) tickId = setInterval(tick, 250);
    if (!need && tickId) { clearInterval(tickId); tickId = 0; }
  }
  function stopBeep() { if (beepId) { clearInterval(beepId); beepId = 0; } }

  /** Startet (oder setzt fort) den Timer eines Schritts. minutes ist die kürzere Dauer, range der Text. */
  function start(step, label, minutes, range) {
    unlockAudio();
    if ("Notification" in window && Notification.permission === "default" && !(window.claude && window.claude.use)) {
      try { Notification.requestPermission(); } catch (e) { /* egal */ }
    }
    let t = step && timers.find((x) => x.step === step);
    if (t && t.ring) { remove(t.id); return; }
    if (t) { toggle(t.id); return; }
    const ms = Math.max(1, Math.round(minutes * 60)) * 1000;
    t = { id: "t" + ++seq + "-" + now().toString(36), step: step || "", label: label || "Timer", range: range || "", ms, end: now() + ms, left: ms, ring: 0 };
    timers.push(t);
    save(); render(); tick(); syncWake();
  }

  function toggle(id) {
    const t = timers.find((x) => x.id === id);
    if (!t || t.ring) return;
    unlockAudio();
    if (t.end) { t.left = remaining(t); t.end = 0; } else t.end = now() + t.left;
    save(); render(); tick(); syncWake();
  }
  function add(id, sec) {
    const t = timers.find((x) => x.id === id);
    if (!t) return;
    unlockAudio();
    if (t.ring) { t.ring = 0; t.end = now() + sec * 1000; t.left = sec * 1000; }
    else if (t.end) t.end += sec * 1000;
    else t.left += sec * 1000;
    t.ms += sec * 1000;
    save(); render(); tick(); syncWake();
  }
  function remove(id, quiet) {
    timers = timers.filter((x) => x.id !== id);
    if (!quiet) { save(); render(); tick(); syncWake(); }
  }

  // ---- Darstellung ----------------------------------------------------------------------------------------
  function render() {
    if (!el) return;
    el.hidden = !timers.length;
    el.innerHTML = timers.map((t) => {
      const st = t.ring ? "ring" : t.end ? "run" : "pause";
      const pct = t.ms ? Math.min(100, 100 * (1 - remaining(t) / t.ms)) : 100;
      return '<div class="tmr-card ' + st + '" data-id="' + esc(t.id) + '"' + (t.step ? ' data-step="' + esc(t.step) + '"' : "") + ">" +
        '<div class="tmr-top"><span class="tmr-lbl">' + esc(t.label) + "</span>" +
        '<button type="button" class="x-btn" data-tact="del" aria-label="Timer entfernen">×</button></div>' +
        '<div class="tmr-time" aria-live="off">' + (t.ring ? "Fertig!" : fmt(remaining(t))) + "</div>" +
        (t.range ? '<div class="tmr-sub">' + esc(t.range) + (t.ring && /[–-]/.test(t.range) ? " – jetzt prüfen" : "") + "</div>" : "") +
        '<div class="tmr-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<div class="tmr-btns">' + (t.ring
          ? '<button type="button" class="btn sm primary" data-tact="stop">Aus</button>' +
            (t.step ? '<button type="button" class="btn sm" data-tact="stop-done">Aus + abhaken</button>' : "") +
            '<button type="button" class="btn sm ghost" data-tact="plus" data-sec="60">+1 min</button>'
          : '<button type="button" class="btn sm" data-tact="toggle">' + (t.end ? "Pause" : "Weiter") + "</button>" +
            '<button type="button" class="btn sm ghost" data-tact="plus" data-sec="60">+1 min</button>' +
            '<button type="button" class="btn sm ghost" data-tact="plus" data-sec="300">+5</button>') + "</div></div>";
    }).join("");
    if (ringing()) el.setAttribute("aria-label", "Timer, einer ist abgelaufen"); else el.setAttribute("aria-label", "Timer");
  }

  /** Laufende Zeit in den Knöpfen der Karte und der Leiste aktualisieren (ohne neu aufzubauen). */
  function paint() {
    for (const card of el ? el.querySelectorAll(".tmr-card") : []) {
      const t = timers.find((x) => x.id === card.dataset.id);
      if (!t) continue;
      const tm = card.querySelector(".tmr-time");
      if (tm && !t.ring) tm.textContent = fmt(remaining(t));
      const bar = card.querySelector(".tmr-bar span");
      if (bar) bar.style.width = (t.ms ? Math.min(100, 100 * (1 - remaining(t) / t.ms)) : 100).toFixed(1) + "%";
    }
    for (const b of document.querySelectorAll(".tmr[data-timer]")) {
      const t = timers.find((x) => x.step === b.dataset.timer);
      const span = b.querySelector(".tmr-t");
      if (!span) continue;
      if (b.dataset.orig == null) b.dataset.orig = span.textContent;
      b.classList.toggle("run", !!(t && t.end && !t.ring));
      b.classList.toggle("pause", !!(t && !t.end && !t.ring));
      b.classList.toggle("ring", !!(t && t.ring));
      span.textContent = !t ? b.dataset.orig : t.ring ? "fertig" : fmt(remaining(t));
      b.title = !t ? "Timer starten" : t.ring ? "Timer abgelaufen" : t.end ? "Timer anhalten" : "Timer fortsetzen";
    }
  }

  function onClick(e) {
    const b = e.target.closest("[data-tact]");
    if (!b) return;
    const card = b.closest(".tmr-card"), id = card && card.dataset.id;
    const t = timers.find((x) => x.id === id);
    if (!t) return;
    switch (b.dataset.tact) {
      case "del": remove(id); break;
      case "toggle": toggle(id); break;
      case "plus": add(id, +b.dataset.sec || 60); break;
      case "stop": remove(id); break;
      case "stop-done": remove(id); if (t.step && hooks.onDone) hooks.onDone(t.step); break;
    }
  }

  function init(container, h) {
    el = container; hooks = h || {};
    load();
    el.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", () => { tick(); syncWake(); });
    render(); tick();
  }

  FK.kitchen = { init, start, paint, has: (step) => timers.some((t) => t.step === step), active: () => timers.length > 0 };
})(window.FK = window.FK || {});
