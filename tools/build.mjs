// Erzeugt index.html aus page.html (dem Seiteninhalt fürs Artefakt) und aktualisiert sw.js.
// Titel, Meta-Angaben, Stylesheets und js/theme.js am Anfang von page.html wandern in den <head>;
// dazu kommen Manifest und Icons für „Zum Home-Bildschirm“ auf Handy und iPad.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "page.html"), "utf8");

// führende Kopf-Elemente abtrennen
const lines = page.split("\n");
let i = 0;
const head = [];
while (i < lines.length && /^\s*(<title>|<meta |<link |<script src=[^>]*><\/script>\s*$|$)/.test(lines[i])) head.push(lines[i++]);
const body = lines.slice(i).join("\n").trim();

const pwa = `<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Flusskarte">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">`;

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<!-- erzeugt von tools/build.mjs aus page.html – nicht von Hand bearbeiten -->
${head.filter((l) => l.trim()).join("\n")}
${pwa}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("index.html geschrieben");

// Service Worker: Dateiliste und Version aus den tatsächlich eingebundenen Dateien
const refs = new Set(["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]);
for (const m of page.matchAll(/(?:src|href)="((?:js\/|styles)[^"]+)"/g)) refs.add(m[1]);
const assets = [...refs];
const hash = crypto.createHash("sha256");
for (const a of assets) {
  const p = path.join(root, a === "./" ? "index.html" : a);
  if (fs.existsSync(p)) hash.update(fs.readFileSync(p));
  else console.warn("fehlt:", a);
}
const version = hash.digest("hex").slice(0, 10);
const swPath = path.join(root, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`)
  .replace(/const ASSETS = \[[^\]]*\];/, "const ASSETS = " + JSON.stringify(assets) + ";");
fs.writeFileSync(swPath, sw);
console.log("sw.js: " + assets.length + " Dateien, Version " + version);
