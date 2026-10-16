// Erzeugt index.html (lokal per Doppelklick nutzbar) aus page.html, dem Seiteninhalt fürs Artefakt.
// Das Artefakt bekommt sein Dokumentgerüst beim Veröffentlichen; lokal liefert es dieses Skript.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "page.html"), "utf8");
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<!-- erzeugt von tools/build.mjs aus page.html – nicht von Hand bearbeiten -->
</head>
<body>
${page}
</body>
</html>
`;
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("index.html geschrieben");
