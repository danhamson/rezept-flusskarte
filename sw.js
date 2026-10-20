/* Flusskarte – Service Worker: die App läuft nach dem ersten Besuch auch offline (Küche, Keller, Funkloch).
 * Netz zuerst, damit Änderungen sofort ankommen; ohne Netz die zuletzt geladene Fassung.
 * VERSION und ASSETS schreibt tools/build.mjs.
 */
const VERSION = "937674188b";
const ASSETS = ["./","index.html","manifest.webmanifest","icons/icon.svg","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","fonts/fonts.css","styles.css","js/theme.js","js/lexicon.js","js/model.js","js/parser.js","js/layout.js","js/schedule.js","js/render.js","js/share.js","js/ai.js","js/print.js","js/kitchen.js","js/app.js","fonts/barlow-condensed-n500-latin-ext.woff2","fonts/barlow-condensed-n500-latin.woff2","fonts/barlow-condensed-n600-latin-ext.woff2","fonts/barlow-condensed-n600-latin.woff2","fonts/barlow-condensed-n700-latin-ext.woff2","fonts/barlow-condensed-n700-latin.woff2","fonts/barlow-semi-condensed-i400-latin-ext.woff2","fonts/barlow-semi-condensed-i400-latin.woff2","fonts/barlow-semi-condensed-n400-latin-ext.woff2","fonts/barlow-semi-condensed-n400-latin.woff2","fonts/barlow-semi-condensed-n500-latin-ext.woff2","fonts/barlow-semi-condensed-n500-latin.woff2","fonts/barlow-semi-condensed-n600-latin-ext.woff2","fonts/barlow-semi-condensed-n600-latin.woff2","fonts/barlow-semi-condensed-n700-latin-ext.woff2","fonts/barlow-semi-condensed-n700-latin.woff2","fonts/ibm-plex-mono-n400-latin-ext.woff2","fonts/ibm-plex-mono-n400-latin.woff2","fonts/ibm-plex-mono-n500-latin-ext.woff2","fonts/ibm-plex-mono-n500-latin.woff2","fonts/source-serif-4-i400-latin-ext.woff2","fonts/source-serif-4-i400-latin.woff2","fonts/source-serif-4-n400-latin-ext.woff2","fonts/source-serif-4-n400-latin.woff2"];
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
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
