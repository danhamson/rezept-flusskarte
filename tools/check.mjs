// Prüft Parser, Layout und Zeitplan ohne Browser.
//   node tools/check.mjs              Regressionstests (Exit-Code 1 bei Fehlern)
//   node tools/check.mjs rezept.txt   Umwandlung eines Rezepts ausgeben
//   node tools/check.mjs --dump       dasselbe für das Beispiel (Kartoffelgratin)
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
for (const f of ["lexicon", "model", "parser", "layout", "schedule", "render", "share"]) {
  const p = path.join(root, "js", f + ".js");
  if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: p });
}
const FK = globalThis.FK;
const M = FK.model;
const sample = (name) => fs.readFileSync(path.join(root, "samples", name), "utf8");
// Kopierte Rezeptseiten (Aufbau wie die jeweilige Seite, Rezepttext selbst geschrieben); siehe samples/seiten/README.md
const page = (name) => fs.readFileSync(path.join(root, "samples", "seiten", name), "utf8");

// ---- Ausgabe eines Rezepts ------------------------------------------------------------------

function dump(file) {
  const m = FK.parse(fs.readFileSync(file, "utf8"));
  const idx = M.index(m);

  console.log(`Titel: ${m.title} | Portionen: ${m.servings} | Zeit: ${m.statedTime}`);
  console.log("\nZutaten:");
  for (const z of m.ingredients) console.log(`  ${z.id.padEnd(4)} ${M.fmtAmount(z).padEnd(10)} ${z.name}${z.note ? " — " + z.note : ""}${z.optional ? " [optional]" : ""}${z.missing ? " [FEHLT]" : ""}`);
  console.log("\nGeräte:");
  for (const g of m.equipment) console.log(`  ${g.id.padEnd(4)} ${g.name}${g.note ? " — " + g.note : ""}`);
  console.log("\nSchritte:");
  m.steps.forEach((s, i) => {
    const ins = s.inputs.map((x) => M.refLabel(m, x.ref, idx) + (x.portion ? ` [${x.portion}]` : "")).join(" + ");
    const meta = [s.detail, s.temp, M.durText(s.dur), s.passive ? "passiv" : "", s.repeat ? "×" + s.repeat : "", s.product ? "→ " + s.product : ""].filter(Boolean).join(" | ");
    console.log(`  #${i + 1} (${s.srcStep}) ${s.verb}  ⟵ ${ins}${meta ? "\n        " + meta : ""}${s.cue ? "\n        bis: " + s.cue : ""}${s.note ? "\n        Hinweis: " + s.note : ""}`);
  });
  console.log("\nPrüfung:");
  for (const l of M.lint(m)) console.log(`  [${l.level}] ${l.text}`);

  const g = FK.layout.build(m);
  console.log(`\nKarte: ${g.rows.length} Zeilen × ${g.cols} Operationsspalten`);
  for (const r of g.rows) {
    const cells = g.grid[r.index].map((c) => (!c ? "·" : c.type === "op" && c.r0 === r.index ? "[" + c.step.verb.slice(0, 10) + "]" : c.type === "fill" && c.r0 === r.index ? "—" : c.type === "op" ? "|" : " "));
    console.log(`  ${(r.label || "").slice(0, 28).padEnd(28)} ${cells.join(" ")}`);
  }
  const sc = FK.schedule.plan(m);
  console.log(`\nZeitplan: gesamt ${sc.total} min, aktiv ${sc.active} min`);
  for (const t of sc.items) console.log(`  ${String(t.start).padStart(4)}–${String(t.end).padEnd(4)} ${t.passive ? "warten" : "aktiv "} #${t.order + 1} ${t.step.verb}${t.est ? " (geschätzt)" : ""}`);
}

// ---- Regressionstests -------------------------------------------------------------------------
// Ein Fall mit "known" beschreibt einen bekannten, noch offenen Fehler: Er wird gemeldet,
// lässt den Lauf aber nicht scheitern. Besteht er, ist die Markierung zu entfernen.

/** Hilfen für einen umgewandelten Rezepttext. */
function recipe(text) {
  const m = FK.parse(text);
  const idx = M.index(m);
  const ing = (name) => m.ingredients.find((z) => z.name === name);
  const steps = (verb) => m.steps.filter((s) => s.verb === verb);
  const step = (verb, n) => steps(verb)[n || 0];
  // alle Zutaten, Geräte und Schritte, aus denen ein Schritt entsteht
  const upstream = (s) => {
    const seen = new Set();
    const walk = (x) => {
      for (const inp of x.inputs) {
        if (seen.has(inp.ref)) continue;
        seen.add(inp.ref);
        const e = idx.byId.get(inp.ref);
        if (e && e.kind === "step") walk(e.node);
      }
    };
    if (s) walk(s);
    return seen;
  };
  const reaches = (s, ref) => upstream(s).has(ref);
  const portionOf = (s, ref) => ((s && s.inputs.find((x) => x.ref === ref)) || {}).portion;
  const lint = M.lint(m);
  // Hilfen für die Seiten-Fälle: Zutaten als „Menge|Name|Zusatz“, Anzahl der Originalschritte, Warnungen
  const ingList = () => m.ingredients.map((z) => [M.fmtAmount(z).replace(/\s/g, " "), z.name, z.note].filter(Boolean).join("|"));
  const srcSteps = () => new Set(m.steps.map((s) => s.srcStep)).size;
  const warnings = () => lint.filter((l) => l.level !== "info").map((l) => l.text);
  const last = () => m.steps[m.steps.length - 1];
  return { m, idx, ing, steps, step, upstream, reaches, portionOf, lint, ingList, srcSteps, warnings, last, plan: () => FK.schedule.plan(m) };
}

const CASES = [
  {
    name: "Beispiel Kartoffelgratin",
    text: sample("kartoffelgratin.txt"),
    check(r, t) {
      t.eq(r.m.servings, 4, "Portionen");
      t.eq(r.m.ingredients.length, 11, "Zutaten");
      t.eq(r.m.steps.length, 15, "Schritte");
      const pre = r.step("vorheizen"), bake = r.step("backen"), bake2 = r.step("backen", 1);
      t.eq(pre && pre.temp, "180 °C", "Temperatur beim Vorheizen");
      t.ok(pre && pre.passive, "Vorheizen ist Wartezeit");
      t.ok(bake && bake.inputs.some((x) => x.ref === pre.id), "Backen nimmt den vorgeheizten Ofen");
      t.eq(M.durText(bake && bake.dur), "35–40 min", "Dauer des ersten Backschritts");
      t.ok(r.reaches(bake2, bake.id), "Zweiter Backschritt setzt den ersten fort");
      t.eq(r.portionOf(r.step("abschließen"), r.ing("Parmesan").id), "Rest", "Rest des Parmesans");
      const warn = r.lint.filter((l) => l.level !== "info");
      t.eq(warn.length, 1, "genau eine Warnung");
      t.ok(warn[0] && /Butter.*für die Form/.test(warn[0].text), "Warnung zur Butter für die Form");
      const sc = r.plan(), at = (s) => sc.items.find((i) => i.step === s);
      t.eq(at(pre).end, at(bake).start, "Ofen ist genau zum Backen heiß");
    }
  },
  {
    name: "Beispiel Spaghetti aglio e olio",
    text: sample("spaghetti-aglio-olio.txt"),
    check(r, t) {
      t.eq(r.m.steps.length, 10, "Schritte");
      t.eq(r.m.steps[r.m.steps.length - 1].verb, "servieren", "letzter Schritt");
      t.eq(r.lint.length, 0, "keine Befunde der Prüfung");
      const d = r.step("andünsten");
      t.eq(M.durText(d && d.dur), "2 min", "Dauer beim Andünsten");
      t.ok(d && /hellgelb/.test(d.cue), "Garpunkt beim Andünsten");
    }
  },
  {
    name: "Befund 1: Imperativ (du-Form)",
    text: "Rührei (2 Portionen)\nZutaten\n* 4 Eier\n* 1 EL Butter\n* Salz\nZubereitung\n1. Verquirle die Eier mit Salz.\n2. Schmilz die Butter in einer Pfanne.\n3. Gib die Eier hinein und rühre sie 3 Minuten, bis sie stocken.",
    check(r, t) {
      const mix = r.step("verquirlen"), melt = r.step("schmelzen"), stir = r.m.steps[r.m.steps.length - 1];
      t.ok(mix && mix.inputs.some((x) => x.ref === r.ing("Eier").id), "„Verquirle die Eier“ erkannt");
      t.ok(melt && melt.inputs.some((x) => x.ref === r.ing("Butter").id), "„Schmilz die Butter“ erkannt");
      t.eq(stir && stir.verb, "rühren", "„rühre sie“ als letzter Schritt");
      t.eq(M.durText(stir && stir.dur), "3 min", "Dauer beim Rühren");
      t.ok(stir && r.reaches(stir, mix.id) && r.reaches(stir, melt.id), "Eier kommen in die Pfanne");
      t.eq(r.lint.filter((l) => l.level !== "info").length, 0, "keine Warnungen");
    }
  },
  {
    name: "Befund 1: Imperativ mit abgetrenntem Verbteil",
    text: "Soße\nZutaten\n* 1 Zwiebel\n* 200 ml Sahne\nZubereitung\n1. Schneide die Zwiebel klein.\n2. Dann gieße die Sahne an.",
    check(r, t) {
      t.ok(r.step("kleinschneiden"), "„Schneide … klein“ → kleinschneiden");
      t.ok(r.step("angießen"), "„gieße … an“ → angießen");
      t.ok(r.reaches(r.step("angießen"), r.step("kleinschneiden") && r.step("kleinschneiden").id), "Sahne kommt zur Zwiebel");
    }
  },
  {
    name: "Befund 2: zwei Gerichte im Ofen",
    text: "Menü\nZutaten\n* 1 Hähnchen\n* 500 g Kartoffeln\nZubereitung\n1. Ofen auf 200 °C vorheizen.\n2. Hähnchen 60 Min. backen.\n3. Kartoffeln schälen und auf einem Backblech bei 220 °C 30 Min. backen.\n4. Hähnchen mit Kartoffeln servieren.",
    check(r, t) {
      const pre = r.step("vorheizen"), chicken = r.step("backen"), potatoes = r.step("backen", 1), serve = r.step("servieren");
      t.ok(chicken && r.reaches(chicken, pre.id), "Hähnchen kommt in den vorgeheizten Ofen");
      t.ok(potatoes && !r.reaches(potatoes, chicken.id), "Kartoffeln werden nicht mit dem Hähnchen gebacken");
      t.ok(potatoes && r.reaches(potatoes, pre.id), "Kartoffeln kommen in den vorgeheizten Ofen");
      t.ok(serve && r.reaches(serve, chicken.id) && r.reaches(serve, potatoes.id), "Servieren führt beide zusammen");
      // Befund 4c: ein Ofen, zwei Temperaturen → nacheinander
      const sc = r.plan(), a = sc.items.find((i) => i.step === chicken), b = sc.items.find((i) => i.step === potatoes);
      t.ok(a && b && (a.end <= b.start || b.end <= a.start), `200 °C und 220 °C überlappen nicht (${a && a.start}–${a && a.end}, ${b && b.start}–${b && b.end})`);
      t.eq(r.lint.filter((l) => l.level !== "info").length, 0, "keine Warnungen");
    }
  },
  {
    name: "Befund 5: Anteile beim Umrechnen der Portionen",
    text: "Teig (4 Portionen)\nZutaten\n* 300 g Mehl\n* 250 ml Milch\n* 3 Eier\n* 2-3 Knoblauchzehen\nZubereitung\n1. 200 g Mehl mit der Milch und 2 Eiern verrühren.\n2. 1 Knoblauchzehe reiben und unterrühren.\n3. Das restliche Mehl unterrühren.",
    check(r, t) {
      const html = FK.render.flowCard(r.m, { servings: 8 }).html;
      // fmtAmount trennt Zahl und Einheit mit geschütztem Leerzeichen, daher \s
      t.ok(/>400\sg</.test(html) && />von 600\sg</.test(html), "200 g von 300 g → 400 g von 600 g");
      t.ok(/>4</.test(html) && />von 6</.test(html), "2 Eier von 3 → 4 von 6");
      t.ok(/>Rest</.test(html), "Rest bleibt Rest");
      t.eq(M.scalePortion("1 Zehe", 2), "2 Zehen", "Einheit in der Mehrzahl");
      t.eq(M.scalePortion("2 Zehen", 0.5), "1 Zehe", "Einheit in der Einzahl");
      t.eq(M.scalePortion("1 Zehe, halbiert", 3), "3 Zehen, halbiert", "Zusatz bleibt");
      t.eq(M.scalePortion("½", 2), "½", "Bruchteil ist relativ");
      t.eq(M.scalePortion("⅔", 2), "⅔", "Bruchteil ist relativ");
      t.eq(M.scalePortion("etwas", 2), "etwas", "Mengenwort bleibt");
      t.eq(M.scalePortion("1 Teil", 2), "1 Teil", "„Teil“ ist relativ");
      t.eq(M.scalePortion("½ TL", 2), "1 TL", "Bruch mit Einheit ist absolut");
      t.eq(M.scalePortion("200 g", 1), "200 g", "Faktor 1 lässt den Text unverändert");
    }
  },
  {
    name: "Befund 6: Grad, Stunden mit Minuten, über Nacht",
    text: "Kuchen (12 Stück)\nZutaten\n* 200 g Mehl\n* 100 g Zucker\n* 2 Eier\nZubereitung\n1. Ofen auf 180 Grad vorheizen.\n2. Mehl, Zucker und Eier verrühren und über Nacht ruhen lassen.\n3. 1 Stunde 30 Minuten backen.",
    check(r, t) {
      t.eq(r.step("vorheizen") && r.step("vorheizen").temp, "180 °C", "„180 Grad“ als Temperatur");
      t.eq(M.durText(r.step("backen") && r.step("backen").dur), "90 min", "„1 Stunde 30 Minuten“");
      const rest = r.step("ruhen lassen");
      t.ok(rest && rest.dur && rest.dur.min >= 480, "„über Nacht“ dauert mindestens 8 Stunden");
      t.ok(rest && rest.dur && rest.dur.est, "„über Nacht“ ist geschätzt");
    }
  },
  {
    name: "Befund 6: Minzblätter sind keine Minuten",
    text: "Joghurt (1 Portion)\nZutaten\n* 150 g Joghurt\n* 2 Minzblätter\nZubereitung\n1. Joghurt in eine Schale geben.\n2. 2 Minzblätter darauf legen.",
    check(r, t) {
      t.eq(r.step("legen") && r.step("legen").dur, null, "keine Dauer");
    }
  },
  {
    name: "Befund 6: Zeitangaben anzeigen",
    text: "",
    check(r, t) {
      t.eq(M.durText({ min: 120, max: 150 }), "120–150 min", "gemischt in Minuten");
      t.eq(M.durText({ min: 120, max: 180 }), "2–3 h", "volle Stunden");
      t.eq(M.durText({ min: 90, max: 90 }), "90 min", "90 Minuten");
      t.eq(M.durText({ min: 480, max: 720, est: true }), "≈ 8–12 h", "geschätzte Stunden");
      const p = FK.parser;
      t.eq(p.durationIn("1 Std. 30 Min. garen"), { min: 90, max: 90 }, "„1 Std. 30 Min.“");
      t.eq(p.durationIn("1½ Stunden schmoren"), { min: 90, max: 90 }, "„1½ Stunden“");
      t.eq(p.durationIn("1-2 Stunden ruhen"), { min: 60, max: 120 }, "„1-2 Stunden“");
      t.eq(p.durationIn("2 h 15 min backen"), { min: 135, max: 135 }, "„2 h 15 min“");
      t.eq(p.durationIn("10 Minuten kochen, dann 1 Stunde ruhen"), { min: 10, max: 10 }, "erste Angabe zählt");
    }
  },
  {
    name: "Befund 3: Unterheben gehört zur Hauptmasse",
    text: "Rührkuchen (12 Stück)\nZutaten\n* 250 g Butter\n* 200 g Zucker\n* 4 Eier\n* 300 g Mehl\n* 1 Pck. Backpulver\nZubereitung\n1. Ofen auf 175 °C vorheizen. Eine Kastenform einfetten.\n2. Butter und Zucker schaumig rühren, Eier einzeln unterrühren.\n3. Mehl mit Backpulver mischen und unterheben.\n4. Den Teig in die Form füllen und 50 Min. backen.\n5. Auskühlen lassen.",
    check(r, t) {
      t.ok(r.reaches(r.step("backen"), r.ing("Eier").id), "Eier landen im Kuchen");
      t.ok(r.reaches(r.step("backen"), r.ing("Mehl").id), "Mehl landet im Kuchen");
      t.eq(r.lint.filter((l) => l.level !== "info").length, 0, "keine losen Enden");
    }
  },
  {
    name: "Befund 3: „the batter“ ist die angerührte Masse",
    text: "Pancakes (serves 4)\nIngredients\n- 2 cups flour\n- 2 eggs\n- 1 1/2 cups milk\n- 1 tbsp butter\nInstructions\n1. Whisk the flour, eggs and milk.\n2. Melt the butter in a pan.\n3. Pour the batter into the pan and cook for 2 minutes until golden.\n4. Serve.",
    check(r, t) {
      t.ok(r.reaches(r.step("cook"), r.ing("flour").id), "Teig kommt in die Pfanne");
      t.ok(r.reaches(r.step("cook"), r.ing("butter").id), "Butter ist in der Pfanne");
    }
  },
  {
    name: "Befund 3: Rest einkneten setzt den Teig fort",
    text: "Teig (4 Portionen)\nZutaten\n* 300 g Mehl\n* 250 ml Milch\nZubereitung\n1. 200 g Mehl mit der Milch verrühren.\n2. Das restliche Mehl unterkneten.",
    check(r, t) {
      t.ok(r.reaches(r.step("unterkneten"), r.step("verrühren").id), "unterkneten nimmt den Teig");
      t.eq(r.lint.filter((l) => l.level !== "info").length, 0, "keine losen Enden");
    }
  },
  {
    name: "Befund 3: ein Nebenstrang wird nicht ungefragt eingerührt",
    text: "Soße (2 Portionen)\nZutaten\n* 1 Zwiebel\n* 2 Möhren\n* 200 ml Sahne\n* 1 EL Butter\nZubereitung\n1. Zwiebel und Möhren würfeln.\n2. Butter in einem Topf schmelzen.\n3. Sahne unterrühren.\n4. Gemüse darin 10 Min. köcheln lassen.",
    check(r, t) {
      const stir = r.step("unterrühren");
      t.ok(stir && !r.reaches(stir, r.ing("Möhren").id), "Gemüse kommt erst mit „darin“ dazu");
    }
  },
  {
    name: "Befund 4: Nudeln kochen ohne Hände, sofort abgießen",
    text: sample("spaghetti-aglio-olio.txt"),
    check(r, t) {
      const boil = r.step("kochen"), drain = r.step("abgießen");
      t.ok(boil && boil.passive, "Kochen ist Wartezeit");
      const sc = r.plan(), at = (s) => sc.items.find((i) => i.step === s);
      t.eq(at(drain).start, at(boil).end, "Abgießen direkt nach dem Kochen");
    }
  },
  {
    name: "Befund 7: Zutaten wiederfinden",
    text: "Frühstück\n4 Eier\n50 g Haferflocken\nSalz\n1. 3 Eier mit Salz verquirlen.\n2. Das restliche Ei und die Haferflocken unterrühren.",
    check(r, t) {
      t.eq(r.m.ingredients.filter((z) => z.missing).length, 0, "„Ei“ findet „Eier“");
      t.ok(r.ing("Salz") && !r.ing("Salz").missing, "„Salz“ steht in der Zutatenliste");
      const z = r.ing("Haferflocken");
      t.ok(z && !r.m.steps.some((s) => r.portionOf(s, z.id) === "Flocken"), "„Haferflocken“ ist kein Anteil „Flocken“");
    }
  },
  {
    name: "Befund 8: Zwischenprodukte mit Partizip",
    text: "Milchreis (2 Portionen)\nZutaten\n* 100 g Reis\n* 500 ml Milch\n* 1 EL Puderzucker\nZubereitung\n1. Milch aufkochen.\n2. Reis zugeben und 30 Min. quellen lassen.\n3. Mit Puderzucker bestäuben.",
    check(r, t) {
      const labels = r.m.steps.map((s) => M.productLabel(r.m, s, r.idx));
      t.ok(!labels.some((l) => /\((quellen lassen|bestäuben)\)$/.test(l)), "kein Infinitiv im Namen: " + labels.join(" | "));
      t.eq(M.participle("unterheben"), "untergehoben", "trennbar, stark");
      t.eq(M.participle("übergießen"), "übergossen", "„über-“ untrennbar");
      t.eq(M.participle("beträufeln"), "beträufelt", "untrennbar, -eln");
      t.eq(M.participle("blanchieren"), "blanchiert", "-ieren ohne ge-");
      t.eq(M.participle("chop"), "chopped", "englisch");
    }
  },
  {
    name: "T2: Rezept-Code mit Größengrenze entpacken",
    text: "",
    async check(r, t) {
      const ok = FK.parse(sample("kartoffelgratin.txt"));
      const back = await FK.share.decode(await FK.share.encode(ok));
      t.eq(back.title, ok.title, "normaler Code geht hin und zurück");
      // 3 MB gleicher Zeichen packen sich auf wenige Kilobyte
      const bomb = new TextEncoder().encode(JSON.stringify({ title: "x".repeat(3 * 1024 * 1024), steps: [] }));
      const packed = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
      const code = "FK1." + Buffer.from(packed).toString("base64url");
      let err = null;
      try { await FK.share.decode(code); } catch (e) { err = e.message; }
      t.ok(code.length < 20000, "präparierter Code ist klein (" + code.length + " Zeichen)");
      t.eq(err, "Der Code ist zu groß für ein Rezept.", "präparierter Code wird abgelehnt");
    }
  },
  {
    name: "T3/T4: Dauer im Struktur-Editor",
    text: "",
    check(r, t) {
      t.eq(M.normDur("7½"), { min: 7.5, max: 7.5 }, "„7½“ wie angezeigt");
      t.eq(M.normDur("35–40"), { min: 35, max: 40 }, "Spanne ohne Einheit");
      t.eq(M.normDur("1–2 h"), { min: 60, max: 120 }, "Stunden");
      t.eq(M.normDur("1,5 Std."), { min: 90, max: 90 }, "Dezimalkomma");
      t.eq(M.normDur("30 Sek."), { min: 0.5, max: 0.5 }, "Sekunden");
      t.eq(M.normDur("90 s"), { min: 1.5, max: 1.5 }, "Sekunden kurz");
      t.eq(M.normDur("10 Minuten"), { min: 10, max: 10 }, "Minuten");
    }
  },
  {
    name: "Kochen: abhaken und Erledigtes ausblenden",
    text: "Gratin (2 Portionen)\nZutaten\n* 2 Zwiebeln\n* 1 kg Kartoffeln\n* 200 ml Sahne\nZubereitung\n1. Zwiebeln in Ringe schneiden.\n2. Kartoffeln schälen.\n3. Kartoffeln in Scheiben hobeln.\n4. Zwiebeln, Kartoffeln und Sahne in eine Form schichten.\n5. 40 Min. backen.",
    check(r, t) {
      const peel = r.step("schälen"), slice = r.step("hobeln"), layer = r.step("schichten"), bake = r.step("backen");
      t.ok(peel && slice && layer && bake, "Schritte erkannt");
      if (!peel || !slice || !layer || !bake) return;
      const ids = (L) => L.cells.filter((c) => c.type === "op").map((c) => c.step.id);
      // Schälen ist ausblendbar (Hobeln ist erledigt), Hobeln bleibt als Spalte vor dem offenen Schichten
      const c1 = FK.render.collapsible(r.m, new Set([peel.id, slice.id]));
      t.eq([...c1], [peel.id], "nur Schälen wird eingeklappt");
      const L1 = FK.layout.build(r.m, { collapse: c1 });
      t.ok(!ids(L1).includes(peel.id) && ids(L1).includes(slice.id), "Schälen fehlt, Hobeln bleibt");
      t.ok(L1.rows.some((x) => x.kind === "done" && x.step === peel), "eine Zeile steht für den eingeklappten Ast");
      t.ok(!L1.rows.some((x) => x.kind === "ingredient" && x.consumer === peel.id), "die Kartoffel-Zeile des Asts entfällt");
      // ein offener Schritt im Ast verhindert das Einklappen
      t.eq([...FK.render.collapsible(r.m, new Set([slice.id, layer.id]))], [], "Hobeln nicht einklappen, solange Schälen offen ist");
      // alles erledigt: nur das Gericht bleibt sichtbar
      const all = new Set(r.m.steps.map((x) => x.id));
      t.eq(ids(FK.layout.build(r.m, { collapse: FK.render.collapsible(r.m, all) })), [bake.id], "nur der letzte Schritt bleibt");
      const html = FK.render.flowCard(r.m, { servings: 2, done: new Set([peel.id]), timers: true }).html;
      t.ok(/data-timer="/.test(html) && /class="op done"/.test(html), "Timer-Knopf und Haken in der App");
      t.ok(!/data-timer=/.test(FK.render.flowCard(r.m, { servings: 2 }).html), "kein Timer-Knopf im Druck");
    }
  },
  {
    name: "Sicherheit: IDs mit $-Zeichen bleiben im HTML wörtlich",
    text: "",
    check(r, t) {
      // IDs aus Rezept-Codes sind beliebiger Text; „$'“ oder „$&“ darf beim Einsetzen kein HTML nachziehen
      const ids = ["s$'x", "s$&y", "s$`z"];
      const m = FK.model.normalize({
        title: "T", servings: 2,
        ingredients: [{ id: "z1", name: "Mehl", qty: 200, unit: "g" }, { id: "z2", name: "Milch", qty: 100, unit: "ml" }],
        steps: [{ id: ids[0], verb: "sieben", inputs: ["z1"] }, { id: ids[1], verb: "verrühren", inputs: [ids[0], "z2"] }, { id: ids[2], verb: "backen", inputs: [ids[1]] }]
      });
      const html = FK.render.flowCard(m, { servings: 2, done: new Set(), timers: true }).html;
      const want = ids.map(FK.render.esc);
      const got = [...new Set([...html.matchAll(/data-for="([^"]*)"/g)].map((x) => x[1]))];
      t.ok(got.length >= 2, "Zutatenzeilen tragen data-for");
      t.eq(got.filter((v) => !want.includes(v)), [], "data-for enthält genau die escapte ID");
    }
  },
  {
    name: "Chefkoch-Seite: Menge, Zutat und Zusatz in eigenen Zeilen",
    text: [
      "Für 4 Portionen", "", "", "4", "", "", "Für den Auflauf:", " n. B.", "Gemüsebrühepulver", "6 m.-große", "Kartoffel(n)",
      "2 Köpfe", "Brokkoli", "Für die Sauce:", "1", "Zwiebel(n)", "2 EL", "Margarine", "2 EL", "Mehl", "0.5 Liter", "Kochwasser",
      "von Kartoffeln und Brokkoli", "1 Pck.", "Sahne", "oder Sojasahne, ca. 200 ml", " etwas", "Muskat", " etwas", "Salz und Pfeffer",
      " viel", "Käse, geriebener", "Bring! LogoAuf die Einkaufsliste setzen", "", "create", "Eigene Kopie erstellen", "Zubereitung", "",
      "55 Min.", "Gesamtzeit", "", "30 Min.", "Arbeitszeit", "", "25 Min.", "Koch-/Backzeit", "1",
      "Zuerst ca. 1 l Wasser zum Kochen bringen und die Gemüsebrühe dazugeben.", "", "2",
      "Währenddessen die Kartoffeln schälen und den Brokkoli putzen und in Röschen schneiden. Die Kartoffeln in Würfel schneiden in der Brühe gar kochen. Die Kartoffeln mit einem Schaumlöffel aus der Brühe nehmen, dann die Brokkoliröschen in der Brühe kochen. Beides in eine große Auflaufform geben.",
      "", "3",
      "Für die Soße eine Zwiebel würfeln und in der Margarine glasig braten. Dann das Mehl darüber streuen und eine Weile bräunen lassen. Dann einen halben Liter von der Gemüsebrühe, in der Kartoffeln und Brokkoli gekocht wurden, hinzugeben und kurz andicken lassen. Anschließend die Sahne zufügen und die Soße mit Muskat, Salz und Pfeffer gut würzen. Die Soße in die Auflaufform geben, den Käse darüber streuen.",
      "", "4", "Bei 180 °C Ober-/Unterhitze ca. 20 - 25 min. in den heißen Backofen stellen, bis der Käse schön braun ist."
    ].join("\n"),
    check(r, t) {
      t.eq(r.m.servings, 4, "Portionen");
      t.eq(r.m.ingredients.map((z) => z.name), ["Gemüsebrühepulver", "Kartoffeln", "Brokkoli", "Zwiebel", "Margarine", "Mehl", "Kochwasser", "Sahne", "Muskat", "Salz", "Pfeffer", "Käse"], "Zutaten");
      t.eq(M.fmtAmount(r.ing("Brokkoli")).replace(/\s/g, " "), "2 Köpfe", "Menge aus der Zeile davor");
      t.eq([M.fmtAmount(r.ing("Kartoffeln")), r.ing("Kartoffeln").note], ["6", "mittelgroße"], "„6 m.-große“ / „Kartoffel(n)“");
      t.eq(M.fmtAmount(r.ing("Kochwasser")).replace(/\s/g, " "), "½ Liter", "„0.5 Liter“");
      t.eq(M.fmtAmount(r.ing("Käse")), "viel", "Mengenwort „viel“");
      t.eq(M.fmtAmount(r.ing("Muskat")), "etwas", "Mengenwort");
      t.ok(r.ing("Gemüsebrühepulver").optional, "„n. B.“ ist nach Belieben");
      t.eq(r.ing("Sahne").note, "oder Sojasahne, ca. 200 ml", "Zusatzzeile als Notiz");
      t.ok(/gesamt 55 Min\..*Arbeitszeit 30 Min\..*Kochen\/Backen 25 Min\./.test(r.m.statedTime), "Zeiten mit Wert vor der Bezeichnung");
      t.eq(new Set(r.m.steps.map((s) => s.srcStep)).size, 4, "vier nummerierte Schritte");
      const cookPot = r.step("kochen"), take = r.step("herausnehmen"), cookBroc = r.step("kochen", 1);
      t.ok(cookPot && r.reaches(cookPot, r.ing("Kartoffeln").id) && r.reaches(cookPot, r.ing("Gemüsebrühepulver").id), "Kartoffeln garen in der Brühe");
      t.ok(take && cookBroc && cookBroc.inputs.some((x) => x.ref === take.id && x.portion === "Brühe") && r.reaches(cookBroc, r.ing("Brokkoli").id), "Brokkoli kocht nach dem Herausnehmen in derselben Brühe");
      const form = r.step("geben");
      t.ok(form && r.reaches(form, r.ing("Kartoffeln").id) && r.reaches(form, r.ing("Brokkoli").id), "Beides kommt in die Form");
      const sauce = r.step("hinzugeben");
      t.ok(sauce && sauce.inputs.some((x) => x.ref === cookBroc.id) && !sauce.inputs.some((x) => x.ref === form.id), "Soße nimmt Brühe, nicht die Form");
      t.ok(r.reaches(r.step("braten"), r.ing("Zwiebel").id), "Zwiebel wird in der Margarine gebraten");
      const last = r.m.steps[r.m.steps.length - 1];
      t.eq([last.verb, last.temp, M.durText(last.dur), last.passive], ["backen", "180 °C", "20–25 min", true], "In den Ofen stellen ist Backen");
      t.ok(r.reaches(last, form.id) && r.reaches(last, sauce.id), "Soße und Gemüse kommen zusammen in den Ofen");
      t.eq(r.lint.filter((l) => l.level !== "info").map((l) => l.text), [], "keine Warnungen");
    }
  },

  // ---- Kopierte Rezeptseiten (samples/seiten) ----------------------------------------------------
  {
    name: "Seite: WordPress-Blog (WP Recipe Maker), du-Form, Bildunterschriften",
    text: page("wordpress-wprm.txt"),
    check(r, t) {
      t.eq([r.m.title, r.m.servings], ["Ragù alla Bolognese wie bei Nonna", 4], "Titel und Portionen ohne Einleitung");
      t.eq(r.m.statedTime, "Vorbereitung 20 Min., Zubereitung 1 Std. 10 Min., gesamt 1 Std. 30 Min.", "„20Minuten Min.“ in der Zeile unter der Bezeichnung");
      t.eq(r.m.ingredients.length, 15, "Zutaten ohne Ankreuzkästchen, „Salz und Pfeffer“ getrennt");
      t.eq(r.ing("Rinderhackfleisch").note, "grob gewolft", "Zusatz hinter dem Hauptwort");
      t.eq(r.srcSteps(), 11, "Bildunterschriften sind keine Schritte");
      t.ok(!r.m.steps.some((s) => /Soffritto im Topf|Ragù im Topf|für das Ragù würfeln|Kommentar/.test(s.src)), "keine Bildunterschrift und nichts nach „Nährwerte“");
      const fry = r.step("andünsten");
      t.ok(fry && M.durText(fry.dur) === "2 min" && r.reaches(fry, r.ing("Pancetta oder durchwachsener Speck").id), "„dünstest darin die Pancetta-Würfel 2 Minuten an“");
      t.ok(/nicht zu heiß/.test(r.step("garen") && r.step("garen").note), "TIPP-Absatz wird Hinweis");
      t.eq(r.step("dünsten") && r.step("dünsten").note, "Ab und zu umrühren", "Nebenbei-Anweisung wird Hinweis");
      t.ok(r.last().verb === "servieren" && r.reaches(r.last(), r.ing("Tagliatelle").id) && r.reaches(r.last(), r.ing("Rinderhackfleisch").id), "„Die Nudeln mit dem Ragù servieren“ findet die Tagliatelle");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Weight Watchers (Name vor der Menge, Angaben mit •)",
    text: page("weightwatchers.txt"),
    check(r, t) {
      t.eq(r.m.servings, 2, "„Portionen: 2“ zwischen den Zeitangaben");
      t.eq(r.m.statedTime, "gesamt 30 Min., Vorbereitung 10 Min., Zubereitung 20 Min.", "Angaben einer Zeile mit • getrennt");
      t.eq(r.ingList(), ["1 Stück|Zwiebel|mittelgross", "1 Zehe|Knoblauch", "1 TL|Öl|Olivenöl", "200 g|Karotten", "400 g|Tomaten|gehackt, Konserve", "300 ml|Gemüsebouillon|zubereitet, 1 TL Instantpulver", "120 g|Teigwaren|Vollkornteigwaren, trocken, Penne", "1 Prise|Salz|Jodsalz"], "Name, dann „Menge, Zusatz“");
      t.eq(r.srcSteps(), 3, "Schrittnummern auf eigener Zeile");
      const simmer = r.step("köcheln lassen");
      t.ok(simmer && M.durText(simmer.dur) === "12 min" && r.reaches(simmer, r.ing("Teigwaren").id) && r.reaches(simmer, r.ing("Knoblauch").id), "alles köchelt in einem Topf");
      t.ok(!r.m.steps.some((s) => /Frittata/.test(s.src + s.note)), "„Das gefällt anderen auch“ beendet das Rezept");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Cookidoo/Thermomix (Name, Zusatz, Menge, Einheit je Zeile; „5 Sek./Stufe 5“)",
    text: page("cookidoo.txt"),
    check(r, t) {
      t.eq(r.m.servings, 4, "„4 Portionen“ allein");
      t.eq(r.m.statedTime, "Zubereitung 15 Min., gesamt 35 Min.", "„Zubereitung 15 Min“ ist eine Zeitangabe, keine Überschrift");
      t.eq(r.ingList(), ["1|Zwiebel|halbiert", "1 Zehe|Knoblauch", "20 g|Olivenöl", "200 g|Möhren|in Stücken", "150 g|rote Linsen", "900 g|Wasser", "1 EL|Gemüsebrühe-Paste", "1 TL|Salz"], "Zeilen zu Zutaten zusammengesetzt");
      t.eq(r.steps("zerkleinern").map((s) => M.durText(s.dur)), ["5 s", "4 s"], "Sekunden");
      const cook = r.step("garen");
      t.eq(cook && [cook.temp, M.durText(cook.dur)], ["100 °C", "20 min"], "„20 Min./100°C/Linkslauf/Stufe 1“");
      t.ok(!r.m.steps.some((s) => /einfach|Schwierigkeit/.test(s.note)), "„Schwierigkeitsgrad“ / „einfach“ nach den Schritten ist kein Hinweis");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: lecker.de (Bewertung, Portionswähler, Nummer direkt am Text)",
    text: page("lecker.txt"),
    check(r, t) {
      t.eq([r.m.title, r.m.statedTime], ["Bunte Gemüse-Spaghetti", "Zubereitung 30 Min."], "Titel und Zeit; „Rezept bewerten“ beendet nichts");
      t.eq(r.m.ingredients.length, 13, "„4,4/5 (47)“ ist keine Zutat");
      t.eq(r.m.ingredients[0].name, "Aubergine", "erste Zutat");
      t.eq(r.srcSteps(), 3, "„1Aubergine, …“ beginnt Schritt 1");
      const fry = r.step("andünsten");
      t.ok(fry && r.reaches(fry, r.ing("Aubergine").id) && r.reaches(fry, r.ing("Zwiebel").id) && !r.reaches(fry, r.ing("Gemüsebrühe").id), "„Gemüse darin andünsten“: das geschnittene Gemüse, nicht die Gemüsebrühe");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: EAT SMARTER (Nährwerte vor den Zutaten, „für / 4 / Portionen“)",
    text: page("eatsmarter.txt"),
    check(r, t) {
      t.eq(r.m.servings, 4, "Portionen über drei Zeilen");
      t.eq(r.ingList(), ["400 g|Möhren", "2|Pastinaken", "1|rote Zwiebel", "4 EL|Rapsöl", "2 TL|Honig", "Salz", "Pfeffer", "200 g|Buchweizen", "2 EL|Apfelessig", "4 Stiele|Petersilie"], "nur die Zutaten, ohne Nährwerte und Linkliste");
      t.eq(r.srcSteps(), 4, "„Zubereitungsschritte“ mit „1.“ auf eigener Zeile");
      const roast = r.step("rösten");
      t.ok(roast && r.reaches(roast, r.ing("Pastinaken").id) && r.reaches(roast, r.ing("rote Zwiebel").id), "„Gemüse mit Öl und Honig mischen“ nimmt das geschnittene Gemüse");
      t.eq(r.last().verb, "servieren", "nichts aus „Ähnliche Rezepte“");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: HelloFresh (Nährwerte vor der Zubereitung, Kochutensilien, Mengen für andere Größen)",
    text: page("hellofresh.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [2, "gesamt 35 Min."], "„Portionsgröße2“, „Gesamtzeit:“ / „35 Minuten“");
      t.eq(r.m.ingredients.map((z) => z.name), ["Kartoffeln", "Seelachs", "Salatgurke", "Zitrone", "Dill", "Semmelbrösel", "Naturjoghurt", "Öl", "Salz", "Butter"], "ohne Allergene, Utensilien und Kalorien");
      t.eq(r.srcSteps(), 5, "mehrere Zeilen je Schrittnummer bleiben ein Schritt");
      const mix = r.step("mischen"), bake = r.step("backen");
      t.eq(r.portionOf(mix, r.ing("Öl").id), "1 EL", "„1 EL [1,5 EL I 2 EL] Öl*“: die Menge für 2 Portionen");
      t.ok(bake && M.durText(bake.dur) === "20–25 min" && r.reaches(bake, r.ing("Kartoffeln").id), "„Kartoffeln halbieren, mit … mischen“: die Kartoffeln kommen aufs Blech");
      t.ok(!r.reaches(r.step("vermengen"), r.ing("Kartoffeln").id), "frisches Salz holt nicht die Ofenkartoffeln in die Fischmasse");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Kitchen Stories („Zubereitung“ / „10 Min.“, „Schritt 1/3“, Utensilien)",
    text: page("kitchenstories.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [2, "Zubereitung 10 Min., Backen 15 Min."], "„2“ / „Portionen“, Zeiten mit Wert in der nächsten Zeile");
      t.eq(r.m.ingredients.map((z) => z.name), ["Eier", "Babyspinat", "Zwiebel", "Milch", "Feta", "Olivenöl", "Salz", "Pfeffer"], "Utensilien sind keine Zutaten");
      t.eq(r.srcSteps(), 3, "„Schritt 1/3“ … „Schritt 3/3“");
      const set = r.step("stocken");
      t.ok(set && r.reaches(set, r.ing("Eier").id) && r.reaches(set, r.ing("Babyspinat").id) && r.reaches(set, r.step("vorheizen").id), "„Eier darübergießen“ setzt die Pfanne fort");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Dr. Oetker (Gruppen mit Doppelpunkt, Zwischenüberschriften, Ofenstufen)",
    text: page("dr-oetker.txt"),
    check(r, t) {
      t.eq(r.m.ingredients.map((z) => z.name), ["Fett", "weiche Butter", "Zucker", "Vanillezucker", "Eier", "Weizenmehl", "Backpulver", "Milch", "Kakaopulver", "Sahne", "Puderzucker"], "„Rührteig:“, „Zum Bestäuben:“ sind keine Zutaten");
      t.eq(r.srcSteps(), 4, "vier Zwischenüberschriften, vier Schritte");
      t.ok(!r.m.steps.some((s) => /^(zubereiten|marmorieren|vorbereiten)$/.test(s.verb)), "Überschriften sind keine Handlungen");
      const pre = r.step("vorheizen");
      t.eq(pre && [pre.temp, pre.detail, pre.note], ["180 °C", "Ober-/Unterhitze", "Heißluft: etwa 160 °C"], "Ofenstufen unter „Backofen vorheizen.“");
      t.eq(r.steps("backen").map((s) => M.durText(s.dur)), ["55 min"], "„in den Backofen schieben und 55 Minuten backen“ ist ein Schritt");
      t.ok(r.reaches(r.step("backen"), r.ing("Fett").id) && r.reaches(r.step("backen"), r.ing("Kakaopulver").id), "gefettete Form und dunkler Teig landen im Ofen");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Instagram (Emojis, 1️⃣, Hashtags)",
    text: page("instagram.txt"),
    check(r, t) {
      t.eq([r.m.title, r.m.servings], ["Cremige One-Pot-Pasta", 2], "Titel ohne Emojis");
      t.eq(r.m.ingredients.map((z) => z.name), ["Spaghetti", "Zwiebel", "Knoblauch", "Gemüsebrühe", "Sahne", "Parmesan", "Salz", "Pfeffer"], "„🛒 Zutaten:“ und „▫️“-Aufzählung");
      t.eq(r.srcSteps(), 4, "„1️⃣ …“ sind nummerierte Schritte");
      const chop = r.step("hacken");
      t.eq(chop && r.m.source.slice(chop.srcRange[0], chop.srcRange[1]), chop && chop.src, "Textstelle passt trotz Emojis zur Quelle");
      t.ok(r.step("geben") && r.step("geben").inputs.some((x) => x.ref === chop.id), "Gehacktes kommt in den Topf");
      t.ok(!r.m.steps.some((s) => /Rezept|#/.test(s.note + s.src)), "„Speichere dir das Rezept!“ und Hashtags fallen weg");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Markdown (Aufgabenliste, Fettdruck, Zitat)",
    text: page("markdown.txt"),
    check(r, t) {
      t.eq([r.m.title, r.m.servings, r.m.statedTime], ["Shakshuka", 2, "Zeit 25 Min."], "„**Portionen:** 2 | **Zeit:** 25 Minuten“");
      t.eq(r.m.ingredients.length, 10, "Zutaten aus „- [ ]“ und „- [x]“");
      t.ok(r.ing("frische Petersilie") && r.ing("frische Petersilie").optional, "„_optional:_“");
      t.eq(r.srcSteps(), 5, "fünf Schritte");
      t.ok(!r.m.steps.some((s) => s.verb === "schneiden"), "„**Gemüse schneiden:**“ ist ein Zwischentitel");
      const set = r.step("stocken");
      t.ok(set && r.reaches(set, r.ing("Eier").id) && r.reaches(set, r.ing("gehackte Tomaten").id) && r.reaches(set, r.ing("Zwiebel").id), "Eier stocken in der Soße mit dem Gemüse");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Tabelle mit Tabulatoren, Angaben mit „ / “",
    text: page("tabelle.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [4, "Arbeitszeit 20 Min., Kochen/Backen 25 Min."], "„Arbeitszeit: ca. 20 Min. / Koch-/Backzeit: …“");
      t.eq(r.ingList(), ["750 g|Kartoffeln|mehligkochende", "1|Zwiebel", "1 Stange|Lauch", "1 l|Gemüsebrühe", "100 ml|Sahne", "Salz", "Pfeffer", "Muskat"], "Menge und Name durch Tabulator getrennt");
      t.eq(r.srcSteps(), 3, "die Kopfzeile unter „Zubereitung“ ist kein Schritt");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: BBC Good Food (englisch, Reiter „Nutrition“, „step 1“)",
    text: page("bbc-goodfood.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [4, "prep 15 Min., cook 1 Std. 5 Min."], "„Prep: 15 mins“, „Cook: 1 hr and 5 mins“, „Serves 4“");
      t.eq(r.ingList(), ["1 tbsp|olive oil", "1|onion|finely chopped", "2 cloves|garlic|crushed", "1|red pepper|deseeded and chopped", "1 tsp|ground cumin", "2 tins|chopped tomatoes|400g", "1 tin|kidney beans|drained, 400g", "150 g|rice"], "Zutaten trotz Reiter, Einheitenwahl und Gruppen");
      t.eq(r.srcSteps(), 4, "„step 1“ … „step 4“");
      const simmer = r.step("simmer");
      t.ok(simmer && r.reaches(simmer, r.ing("kidney beans").id) && r.reaches(simmer, r.ing("onion").id), "„Add the tomatoes and beans, then simmer“");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Tasty Recipes (englisch, Units/Scale, Notes, „Method: Oven“)",
    text: page("tasty-recipes.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [4, "total 45 Min., prep 10 Min., cook 35 Min."], "„Yield: 4 servings 1x“, Zeiten auch nach den Notes");
      t.eq(r.m.ingredients.map((z) => z.name), ["baby potatoes", "olive oil", "garlic", "salt", "black pepper", "lemon"], "ohne Units, Scale, 1x, Cook Mode");
      t.eq(r.srcSteps(), 4, "„Method: Oven“ ist keine Überschrift");
      t.eq(r.step("preheat") && r.step("preheat").temp, "425 °F", "Fahrenheit");
      t.eq(r.last().note, "Leftovers keep for 3 days in the fridge", "Notes werden Hinweis zum Gericht, Category/Cuisine nicht");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Allrecipes (englisch, Wert unter der Bezeichnung, „Step 1“, Fotonachweis)",
    text: page("allrecipes.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [8, "prep 10 Min., cook 15 Min., total 25 Min."], "„Servings:“ / „8“");
      t.eq(r.m.ingredients.length, 7, "ohne „1/2x“ … „Original recipe yields“");
      t.eq(r.srcSteps(), 3, "„Step 1“ … „Step 3“");
      t.ok(!r.m.steps.some((s) => /Photographer|Made It/.test(s.src + s.note)), "Fotonachweis und Knöpfe fallen weg");
      t.ok(r.reaches(r.last(), r.ing("milk").id) && r.reaches(r.last(), r.ing("all-purpose flour").id), "Teig kommt auf die Platte");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seite: Serious Eats (Aufzählung vor den Zutaten, Special Equipment, Notes)",
    text: page("serious-eats.txt"),
    check(r, t) {
      t.eq([r.m.servings, r.m.statedTime], [6, "prep 15 Min., cook 60 Min., total 75 Min."], "„Prep 15 mins“ ohne Doppelpunkt");
      t.eq(r.m.ingredients.map((z) => z.name), ["potatoes", "salt", "olive oil", "rosemary"], "„Why It Works“ ist keine Zutatenliste");
      t.eq(r.srcSteps(), 4, "vier Schritte, Fotonachweis dazwischen");
      t.ok(/a day ahead/.test(r.last().note) && !/baking sheet/.test(r.last().note), "Notes ja, Geräteliste nein");
      t.eq(r.warnings(), [], "keine Warnungen");
    }
  },
  {
    name: "Seiten: Aufzählung vor „Für die Soße:“ bleibt Zutatenliste",
    text: "Pfannkuchen (2 Portionen)\n- 200 g Mehl\n- 2 Eier\nFür die Soße:\n- 100 ml Sahne\nZubereitung\n1. Mehl und Eier verrühren.\n2. Sahne aufkochen.",
    check(r, t) {
      t.eq(r.m.ingredients.map((z) => z.name), ["Mehl", "Eier", "Sahne"], "alle drei Zutaten");
    }
  },
  {
    name: "Seiten: Zutatenzeilen, Sekunden, Namen mit Alternative",
    text: "",
    check(r, t) {
      const z = (line) => { const x = FK.parser.parseIngredientLine(line)[0]; return [M.fmtAmount(x).replace(/\s/g, " "), x.name, x.note, x.optional]; };
      t.eq(z("- [ ] 400 g gehackte Tomaten (Dose)"), ["400 g", "gehackte Tomaten", "Dose", false], "Markdown-Aufgabe");
      t.eq(z("1 EL [1,5 EL I 2 EL] Öl*"), ["1 EL", "Öl", "", false], "HelloFresh: Mengen für andere Größen, Vorrats-Sternchen");
      t.eq(z("10 g [15 g | 20 g] Butter"), ["10 g", "Butter", "", false], "Mengen mit senkrechtem Strich");
      t.eq(z("20 g Parmesan (7)"), ["20 g", "Parmesan", "", false], "Allergen-Nummer");
      t.eq(z("_optional:_ frische Petersilie"), ["", "frische Petersilie", "", true], "Markdown-Hervorhebung");
      t.eq(z("1 Prise(n) Salz/Jodsalz"), ["1 Prise", "Salz", "Jodsalz", false], "„Prise(n)“, Alternative mit Schrägstrich");
      t.eq(z("4 Stiele Petersilie"), ["4 Stiele", "Petersilie", "", false], "Einheit „Stiele“");
      t.eq(z("2 x 400g tins chopped tomatoes"), ["2 tins", "chopped tomatoes", "400g", false], "„2 x 400g tins“");
      t.eq(z("2 garlic cloves crushed"), ["2 cloves", "garlic", "crushed", false], "englisch: Einheit und Zubereitung hinter dem Namen");
      t.eq(M.durText(FK.parser.durationIn("5 Sek./Stufe 5 zerkleinern")), "5 s", "Thermomix-Sekunden");
      t.eq(M.normDur(M.durText({ min: 0.5, max: 0.5 })), { min: 0.5, max: 0.5 }, "„30 s“ hin und zurück");
      t.ok(["pancetta", "speck"].every((k) => M.keysFor("Pancetta oder durchwachsener Speck").includes(k)), "„A oder B“: beide Namen");
      t.ok(!M.tokenMatchesKey("gemüse", "gemüsebrühe") && M.tokenMatchesKey("salat", "salatherz"), "„Gemüse“ ist Oberbegriff, „Salat“ bleibt Kurzform");
      t.ok(M.keysFor("Tagliatelle").includes("nudel"), "„Nudeln“ findet Tagliatelle");
    }
  },
];

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function runTests() {
  let failed = 0, open = 0, fixed = 0;
  for (const c of CASES) {
    const errors = [];
    const t = {
      ok: (cond, msg) => { if (!cond) errors.push(msg); },
      eq: (got, want, msg) => { if (!same(got, want)) errors.push(`${msg}: erwartet ${JSON.stringify(want)}, erhalten ${JSON.stringify(got)}`); }
    };
    try { await c.check(recipe(c.text), t); } catch (e) { errors.push("Ausnahme: " + (e && e.stack || e)); }
    if (c.known) {
      if (errors.length) { open++; console.log(`  offen  ${c.name}  (${c.known})`); }
      else { fixed++; console.log(`  BEHOBEN ${c.name}  – Markierung „known“ entfernen`); }
    } else if (errors.length) {
      failed++;
      console.log(`✗ ${c.name}`);
      for (const e of errors) console.log("    – " + e);
    } else console.log(`✓ ${c.name}`);
  }
  const total = CASES.filter((c) => !c.known).length;
  console.log(`\n${total - failed}/${total} bestanden${open ? `, ${open} bekannte Fehler offen` : ""}${fixed ? `, ${fixed} bekannte Fehler behoben` : ""}`);
  return failed ? 1 : 0;
}

const arg = process.argv[2];
if (arg) dump(arg === "--dump" ? path.join(root, "samples", "kartoffelgratin.txt") : arg);
else process.exitCode = await runTests();
