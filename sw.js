/* Flusskarte – Service Worker: die App läuft nach dem ersten Besuch auch offline (Küche, Keller, Funkloch).
 * Netz zuerst, damit Änderungen sofort ankommen; ohne Netz die zuletzt geladene Fassung.
 * VERSION und ASSETS schreibt tools/build.mjs.
 */
const VERSION = "e3db962f55";
const ASSETS = ["./","index.html","manifest.webmanifest","icons/icon.svg","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","styles.css","js/theme.js","js/lexicon.js","js/model.js","js/parser.js","js/layout.js","js/schedule.js","js/render.js","js/share.js","js/ai.js","js/print.js","js/kitchen.js","js/app.js"];
const CACHE = "flusskarte-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("flusskarte-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const font = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !font) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
