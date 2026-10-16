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
  return { m, idx, ing, steps, step, upstream, reaches, portionOf, lint, plan: () => FK.schedule.plan(m) };
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
