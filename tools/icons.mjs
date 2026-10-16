// Zeichnet das App-Icon (eine kleine Flusskarte) als SVG und PNG: node tools/icons.mjs
// Ohne Abhängigkeiten: Rechtecke werden mit 4×4-Überabtastung gerastert und per zlib als PNG gespeichert.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "icons");
fs.mkdirSync(out, { recursive: true });

const BG = [44, 122, 53], CELL = [63, 154, 71], LINE = [242, 245, 240];
// Entwurf auf 512 × 512; Inhalt im sicheren Bereich für „maskable“-Icons
const T = { x0: 112, y0: 144, x1: 400, y1: 368 };
const lines = [
  // Außenrahmen
  [T.x0 - 10, T.y0 - 10, T.x1 + 10, T.y0 + 10], [T.x0 - 10, T.y1 - 10, T.x1 + 10, T.y1 + 10],
  [T.x0 - 10, T.y0 - 10, T.x0 + 10, T.y1 + 10], [T.x1 - 10, T.y0 - 10, T.x1 + 10, T.y1 + 10],
  // Spalten: Zutaten | erster Schritt | letzter Schritt
  [202, T.y0, 214, T.y1], [298, T.y0, 310, T.y1],
  // vier Zutatenzeilen, zwei zusammengeführte Zellen, eine Endzelle
  [T.x0, 194, 208, 206], [T.x0, 250, 304, 262], [T.x0, 306, 208, 318]
];
function color(x, y) {
  for (const [a, b, c, d] of lines) if (x >= a && x < c && y >= b && y < d) return LINE;
  if (x >= T.x0 && x < T.x1 && y >= T.y0 && y < T.y1) return CELL;
  return BG;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const ss = 4, k = 512 / size;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = color((x + (sx + 0.5) / ss) * k, (y + (sy + 0.5) / ss) * k);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${hex(BG)}"/><rect x="${T.x0}" y="${T.y0}" width="${T.x1 - T.x0}" height="${T.y1 - T.y0}" fill="${hex(CELL)}"/>` +
  lines.map(([a, b, c, d]) => `<rect x="${a}" y="${b}" width="${c - a}" height="${d - b}" fill="${hex(LINE)}"/>`).join("") + "</svg>\n";

fs.writeFileSync(path.join(out, "icon.svg"), svg);
for (const [name, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(path.join(out, name), png(size));
  console.log("icons/" + name);
}
console.log("icons/icon.svg");
