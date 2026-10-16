// Prüft Parser und Layout ohne Browser: node tools/check.mjs [rezept.txt]
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
for (const f of ["lexicon", "model", "parser", "layout", "schedule"]) {
  const p = path.join(root, "js", f + ".js");
  if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: p });
}
const FK = globalThis.FK;
const file = process.argv[2] || path.join(root, "samples", "kartoffelgratin.txt");
const m = FK.parse(fs.readFileSync(file, "utf8"));
const idx = FK.model.index(m);

console.log(`Titel: ${m.title} | Portionen: ${m.servings} | Zeit: ${m.statedTime}`);
console.log("\nZutaten:");
for (const z of m.ingredients) console.log(`  ${z.id.padEnd(4)} ${FK.model.fmtAmount(z).padEnd(10)} ${z.name}${z.note ? " — " + z.note : ""}${z.optional ? " [optional]" : ""}${z.missing ? " [FEHLT]" : ""}`);
console.log("\nGeräte:");
for (const g of m.equipment) console.log(`  ${g.id.padEnd(4)} ${g.name}${g.note ? " — " + g.note : ""}`);
console.log("\nSchritte:");
m.steps.forEach((s, i) => {
  const ins = s.inputs.map((x) => FK.model.refLabel(m, x.ref, idx) + (x.portion ? ` [${x.portion}]` : "")).join(" + ");
  const meta = [s.detail, s.temp, FK.model.durText(s.dur), s.passive ? "passiv" : "", s.repeat ? "×" + s.repeat : "", s.product ? "→ " + s.product : ""].filter(Boolean).join(" | ");
  console.log(`  #${i + 1} (${s.srcStep}) ${s.verb}  ⟵ ${ins}${meta ? "\n        " + meta : ""}${s.cue ? "\n        bis: " + s.cue : ""}${s.note ? "\n        Hinweis: " + s.note : ""}`);
});
console.log("\nPrüfung:");
for (const l of FK.model.lint(m)) console.log(`  [${l.level}] ${l.text}`);

if (FK.layout) {
  const g = FK.layout.build(m);
  console.log(`\nKarte: ${g.rows.length} Zeilen × ${g.cols} Operationsspalten`);
  for (const r of g.rows) {
    const cells = g.grid[r.index].map((c) => (!c ? "·" : c.type === "op" && c.r0 === r.index ? "[" + c.step.verb.slice(0, 10) + "]" : c.type === "fill" && c.r0 === r.index ? "—" : c.type === "op" ? "|" : " "));
    console.log(`  ${(r.label || "").slice(0, 28).padEnd(28)} ${cells.join(" ")}`);
  }
}
if (FK.schedule) {
  const sc = FK.schedule.plan(m);
  console.log(`\nZeitplan: gesamt ${sc.total} min, aktiv ${sc.active} min`);
  for (const t of sc.items) console.log(`  ${String(t.start).padStart(4)}–${String(t.end).padEnd(4)} ${t.passive ? "warten" : "aktiv "} #${t.order + 1} ${t.step.verb}${t.est ? " (geschätzt)" : ""}`);
}
