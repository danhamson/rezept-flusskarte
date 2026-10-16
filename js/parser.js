/* Flusskarte – lokaler Parser: normales Rezept (Text) → Flussgraph.
 *
 * Ablauf:
 *  1. Abschnitte erkennen (Titel, Zutaten, Zubereitung), Portionen und Zeitangaben lesen.
 *  2. Zutatenzeilen in Menge, Einheit, Name, Notiz zerlegen.
 *  3. Jeden Zubereitungsschritt in Sätze und Handlungen teilen (ein Verb je Handlung).
 *  4. Zutaten in den Handlungen wiederfinden. Ein „Halter“ merkt sich, in welchem
 *     Zwischenprodukt eine Zutat gerade steckt; spätere Erwähnungen verweisen darauf.
 *  5. Handlungen ohne eigenes Ausgangsmaterial setzen das aktuelle Gericht fort.
 */
(function (FK) {
  "use strict";
  const lex = FK.lex, M = FK.model;

  const WORD_RE = /[A-Za-zÄÖÜäöüßéèàçâ]+(?:-[A-Za-zÄÖÜäöüßéèàçâ]+)*/g;
  const ABBR_RE = /\b(ca|z\.\s?B|bzw|evtl|ggf|Min|Std|Pck|Msp|EL|TL|Stk|St|Nr|etc|inkl|max|min|Tbs|tsp|oz|lb|lbs|approx|vgl)\./g;
  const ING_HDR = /^(zutaten|ingredients|einkaufsliste|du brauchst|you need|für (?:den|die|das))\b/i;
  const STEP_HDR = /^(zubereitungsschritte|zubereitungsanleitung|zubereitung|anleitung|so geht'?s|so wird'?s gemacht|arbeitsschritte|schritt für schritt|instructions|directions|method|preparation|steps)\b/i;
  // Schrittmarke auf eigener Zeile: „Schritt 2/3“ (Kitchen Stories), „Step 1“ (Allrecipes), „step 1“ (BBC)
  const STEP_MARK = /^(?:schritt|step)\s*\d+(?:\s*(?:\/|von|of)\s*\d+)?\s*:?$/i;
  // Geräteliste (HelloFresh, Kitchen Stories, EAT SMARTER, Blogs): keine Zutaten
  const EQUIP_HDR = /^(utensilien|kochutensilien|küchenutensilien|küchengeräte|geräte und zubehör|equipment|special equipment)$/i;
  // Anmerkungen nach der Zubereitung (Blogs): werden Hinweise zum fertigen Gericht
  const NOTES_HDR = /^(notes|recipe notes|anmerkungen|hinweise|tipps|tipps zum rezept|tipps und tricks|make-ahead(?: and storage)?|storage|aufbewahrung|variationen|variations)$/i;
  // Was nach dem Rezept kommt (Nährwerte, Kommentare, verwandte Rezepte), wird nicht mehr gelesen.
  // Steht es davor (HelloFresh, EAT SMARTER: Nährwerte vor der Zubereitung), liest die nächste Überschrift weiter.
  const END_HDR = /^(nährwerte|nährwertangaben|nährwert|nutrition|was meinst du|kommentare?|rezept bewerten|hast du (?:dieses|das|mein)\b.*ausprobiert|did you make this recipe|ähnliche rezepte|rezeptideen mit ähnlichen zutaten|das gefällt anderen auch|das könnte (?:dir|dich) auch (?:gefallen|interessieren)|weitere rezepte|mehr rezepte|you might also like|more recipes|related recipes|recipe from\b)/i;
  // Kopfangaben von Rezeptseiten; der Wert steht oft in der nächsten Zeile („Vorbereitungszeit“ / „20Minuten Min.“)
  const META_TIME = /^(vorbereitungszeit|zubereitungszeit|arbeitszeit|koch-\s*\/\s*backzeit|kochzeit|backzeit|garzeit|ruhezeit|wartezeit|gesamtzeit|prep time|cook time|total time)\b\s*:?\s*(.*)$/i;
  // Kurze Bezeichnung nur mit Zeitwert: „Gesamt 35 Min“ (Cookidoo), „Prep: 15 mins“ (BBC), „Zeit: 25 Minuten“
  const META_SHORT = /^(vorbereitung|zubereitung|gesamt|zeit|prep|cook|total|active|inactive)\s*:?\s+(.+)$/i;
  const META_TIME_LABEL = { vorbereitungszeit: "Vorbereitung", zubereitungszeit: "Zubereitung", arbeitszeit: "Arbeitszeit", "koch-/backzeit": "Kochen/Backen", kochzeit: "Kochen", backzeit: "Backen", garzeit: "Garen", ruhezeit: "Ruhen", wartezeit: "Warten", gesamtzeit: "gesamt", preptime: "prep", cooktime: "cook", totaltime: "total", vorbereitung: "Vorbereitung", zubereitung: "Zubereitung", gesamt: "gesamt", zeit: "Zeit", prep: "prep", cook: "cook", total: "total", active: "active", inactive: "inactive" };
  // Zeitwert allein auf einer Zeile; bei Chefkoch steht er vor der Bezeichnung („55 Min.“ / „Gesamtzeit“)
  const TIME_ONLY = /^(?:ca\.|etwa|about|approx\.?)?\s*\d+(?:[,.]\d+)?\s*(?:minuten|minute|min\.?|mins|minutes|stunden?|std\.?|h|hrs?|hours?)(?:\s*(?:und|and)?\s*\d+\s*(?:minuten|min\.?|mins|minutes))?\.?$/i;
  // Bedienelemente kopierter Rezeptseiten: Knöpfe, Portionsrechner („1/2x“, „Units“), Bewertungen („4,4/5 (47)“)
  const UI_NOISE = /^(?:bring!.*|.*\bauf die einkaufsliste setzen|eigene kopie erstellen|create|drucken|rezept drucken|print(?: recipe)?|pin(?: recipe)?|pdf|teilen(?:ins kochbuch \d*)?|ins kochbuch(?: \d+)?|merken|rezept speichern|zurück zum kochbuch|einkaufsliste drucken|wie gesund sind die hauptzutaten\??|jump to (?:recipe|nutrition facts)|skip to (?:ingredients|recipe)|cook mode|prevent your screen from going dark|keep the screen awake.*|units(?:\s*:\s*\w+)?|us|metric|imperial|m|scale|\d+(?:\/\d+)?x|original recipe \(\d+x\) yields.*|get recipe ingredients|i made it|rate|freezable|nicht (?:in deiner lieferung|im lieferumfang) enthalten|\d+(?:[,.]\d+)?\s*\/\s*5(?:\s*\(\d+\))?|\(\d+\))$/i;
  // Nur Hashtags („#pasta #onepot“)
  const HASHTAGS = /^#[^\s#]+(?:\s+#[^\s#]+)*$/;
  // Emojis und Bildzeichen; Aufzählungszeichen, die BULLET_RE kennt, bleiben
  const KEEP_SIGNS = "▢☐□◻◽▪■○●◦✓✔☑";
  let PICTO;
  try { PICTO = new RegExp("[\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}\\uFE0F\\u200D]", "gu"); }
  catch (e) { PICTO = /[\u2190-\u2BFF\uFE0F\u200D]|[\uD83C-\uD83E][\uDC00-\uDFFF]/g; }
  // Mengenwörter statt Zahl in der Zutatenliste („etwas Muskat“, „n. B. Brühepulver“)
  const QTY_WORD = /^(etwas|viel|wenig|reichlich|n\.\s?b\.|nach bedarf)(?=\s|$)\s*/i;
  const META_OTHER = /^(?:portionen|personen|servings|serves|yield|ergibt|kalorien|kcal|brennwert|schwierigkeit(?:sgrad)?|niveau|difficulty|kategorie|category|cuisine|küche|course|keywords?|diet|author|autor|allergene)\b|^portionsgröße|^method\s*:/i;
  // Portionen: „4 Portionen“ allein, „Servings:“ / „8“, „2“ / „Portionen“ (Kitchen Stories), „für“ / „4“ / „Portionen“ (EAT SMARTER)
  const SERV_LINE = /^(?:für\s+)?(\d+)\s*(?:portionen|portion|personen|portions?|servings?)$/i;
  const SERV_LABEL = /^(?:portionen|personen|portionsgröße|servings|serves)$/i;
  const SERV_WORD = /^(?:portionen|personen|portions?|servings?)$/i;
  // Ofeneinstellung unter „Backofen vorheizen.“ (Dr. Oetker): „Ober-/Unterhitze: etwa 180 °C“
  const OVEN_SET = /^(ober-\s*\/\s*unterhitze|umluft|heißluft|gas(?:herd)?|elektroherd|e-herd)\s*:\s*(.+)$/i;
  // Mengen für andere Portionsgrößen (HelloFresh-Karte): „1 EL [1,5 EL I 2 EL] Öl“
  const SIZE_VARIANTS = /\s*\[[^\]]*(?:\||\sI\s)[^\]]*\]/g;
  const BULLET_RE = /^(?:[*•·\-–]\s+|[▢☐□◻◽▪■○●◦✓✔☑]\s*)/;
  const TIP_RE = /^(?:(?:tipp|tip|hinweis|anmerkung)\b\s*:?|(?:info|achtung|wichtig|note)\s*:)\s*/i;
  // Nebenbei-Anweisungen, die zum vorigen Schritt gehören („ab und zu umrühren“, „falls nötig …“)
  const ASIDE_COND = /^(falls|bei bedarf|nach bedarf|gegebenenfalls|ggf\.?|wer (?:es|mag|möchte)|wenn (?:nötig|gewünscht|du magst|du möchtest))\b/i;
  const OCCASIONAL = /\b(ab und zu|hin und wieder|gelegentlich|immer wieder|zwischendurch|regelmäßig|öfter|öfters)\b/i;
  const STIR = new Set(["umrühren", "rühren", "durchrühren", "wenden", "schwenken"]);
  const CHATTER = /\b(guten appetit|viel spaß|lass(?:t)? (?:es )?(?:dir|euch) schmecken|bon app[eé]tit|speicher(?:e|t)? (?:dir |euch )?(?:das|dieses) rezept|folg(?:e|t) (?:mir|uns)|link in (?:der )?bio|save (?:this|the) recipe|follow (?:me|us) for)\b|^enjoy\b/i;
  // Zahl („1,5“, „1½“, „½“), Spanne, Einheit; die Einheit muss als Wort enden („Minzblätter“ ist keine Zeit).
  // Sekunden für Thermomix-Angaben („5 Sek./Stufe 5“)
  const DUR_NUM = "(\\d+(?:[,.]\\d+)?(?:\\s*[½¼¾])?|[½¼¾])";
  const DUR_RE = new RegExp(DUR_NUM + "(?:\\s*(?:-|–|bis|to)\\s*" + DUR_NUM + ")?\\s*(Minuten|Minute|Min\\.?|mins?|minutes?|Std\\.?|Stunden?|h|hours?|hrs?|Sek\\.?|Sekunden?|secs?|seconds?)(?![A-Za-zÄÖÜäöüß])", "gi");
  const TEMP_RE = /(\d{2,3})\s*(?:°\s*([CF])?|Grad\b(?:\s+(Celsius|Fahrenheit)\b)?)/i;
  const PRODUCT_PIECES = ["ringe", "ringen", "scheiben", "würfel", "streifen", "stifte", "spalten", "mischung", "masse", "soße", "sauce", "creme", "teig", "püree"];
  const NUMBER_WORDS = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, a: 1, an: 1, one: 1, two: 2, three: 3 };

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const words = (text) => { const out = []; let m; WORD_RE.lastIndex = 0; while ((m = WORD_RE.exec(text))) out.push({ w: m[0], lw: m[0].toLowerCase(), i: m.index }); return out; };

  // ---- Verben ---------------------------------------------------------------------

  // Infinitive, die keine Kochhandlung sind
  const AUX = /^(ist|sind|wird|werden|wurde|wurden|hat|haben|sein)$/;
  const LEAD_ADV = /^(und|dann|danach|anschließend|nun|jetzt|zuerst|zunächst|erst|zuletzt|zum|schluss|schließlich|nochmals|nochmal|außerdem|inzwischen|währenddessen|nebenbei|sofort|gleich|bitte)$/;
  const NOT_VERBS = new Set("werden,sollen,sollten,können,müssen,haben,lassen,wollen,dürfen,mögen,bedecken,schmecken,aussehen,bleiben,kosten,gelingen,passen,reichen,stehen,liegen,geben,nehmen,machen,brauchen,verwenden,benötigen".split(","));

  /** Unbekanntes Verb raten: kleingeschriebener Infinitiv am Ende des Satzteils. */
  function guessVerb(ws) {
    for (let k = ws.length - 1; k >= Math.max(0, ws.length - 2); k--) {
      const t = ws[k];
      if (t.w[0] !== t.w[0].toLowerCase()) continue;
      if (/^[a-zäöüß]{4,}(en|ern|eln)$/.test(t.lw) && !NOT_VERBS.has(t.lw) && !AUX.test(t.lw)) return { k, key: t.lw, e: { cls: "other" } };
    }
    return null;
  }

  function findVerb(text, opts) {
    if (/zum\s+(kochen|sieden)\s+bringen/i.test(text)) return { key: "aufkochen", display: "aufkochen", cls: "heat" };
    if (/^\s*dazu\b/i.test(text) && /\breichen\s*$/i.test(text)) return { key: "reichen", display: "dazu reichen", cls: "finish" };
    if (/\baus\s+(?:de[mnr]|dem)\b.*\bnehmen\s*$/i.test(text)) return { key: "herausnehmen", display: "herausnehmen", cls: "prep" };
    const ws = words(text);
    // Partikel eines trennbaren Verbs: letztes Wort außerhalb von Klammern
    const tail = words(text.replace(/\([^)]*\)/g, (m) => " ".repeat(m.length))).pop();
    const cands = [], finite = [];
    ws.forEach((t, k) => {
      const lower = t.w[0] === t.w[0].toLowerCase();
      if (!lower && k !== 0) return; // großgeschrieben mitten im Satz → Substantiv
      const e = lex.V[t.lw];
      if (e) { cands.push({ k, key: t.lw, e }); return; }
      // Befehlsform nur am Anfang des Satzteils („Gib …“, „Dann rühre …“), sonst Substantiv oder Adjektiv
      // und nie als einzelnes Wort oder als Lebensmittel („Salz“ ist nicht „salz!“)
      const imperativeOk = k < ws.length - 1 && !lex.FOODS.includes(t.lw) && ws.slice(0, k).every((w) => LEAD_ADV.test(w.lw));
      const forms = (lex.FINITE[t.lw] || []).filter((f) => !f.imp || imperativeOk);
      if (!forms.length) return;
      // Partizip statt gebeugter Form: „sobald alles vermischt ist“, „wird kurz erhitzt“
      if ((ws[k + 1] && AUX.test(ws[k + 1].lw)) || (k === ws.length - 1 && ws.some((w) => AUX.test(w.lw)))) return;
      const sep = tail && tail.i > t.i ? forms.find((f) => f.particle === tail.lw) : null;
      const f = sep || forms.find((x) => !x.particle);
      if (f) finite.push({ k, key: f.inf, e: lex.V[f.inf], particle: sep ? tail : null });
    });
    if (!cands.length && !finite.length && !(opts && opts.guess === false)) { const g = guessVerb(ws); if (g) cands.push(g); }
    const span = (t) => [t.i, t.i + t.w.length];
    // gebeugtes Verb nur, wenn kein Infinitiv da ist („lässt … köcheln“, „kannst … hinzugießen“)
    if (!cands.length && finite.length) {
      const c = finite[0];
      return { key: c.key, display: c.key, cls: c.e.cls, en: false, k: c.k, finite: true, spans: [span(ws[c.k])].concat(c.particle ? [span(c.particle)] : []) };
    }
    if (!cands.length) return null;
    let c = cands[0].k === 0 && cands[0].e.en ? cands[0] : cands[cands.length - 1];
    let display = c.key;
    const nxt = ws[c.k + 1], prv = ws[c.k - 1], prv2 = ws[c.k - 2];
    if (nxt && nxt.lw === "lassen" && lex.LASSEN.has(c.key)) display += " lassen";
    if (prv && prv.lw === "oder" && prv2 && lex.V[prv2.lw]) {
      display = prv2.lw + " oder " + display;
      c = { k: c.k - 2, key: prv2.lw, e: lex.V[prv2.lw] };
    }
    return { key: c.key, display, cls: c.e.cls, en: !!c.e.en, k: c.k, finite: false, spans: [span(ws[c.k])] };
  }

  // ---- Titel & Zutaten ---------------------------------------------------------------

  function servingsFrom(text, model) {
    const sm = text.match(/\(?\s*(?:für\s+|serves\s+|for\s+)?(\d+(?:[.,]\d+)?)\s*(?:-\s*\d+\s*)?(portionen|portion|personen|person|pers\.|stück|servings?|people)\s*\)?/i)
      || text.match(/\b(?:serves|für|portionen|servings)\s*:?\s+(\d+)\b/i)
      || text.match(/\bportionsgröße\s*:?\s*(\d+)\b/i);
    if (!sm) return text;
    if (!model.servings) model.servings = parseFloat(sm[1].replace(",", "."));
    return (text.slice(0, sm.index) + text.slice(sm.index + sm[0].length)).replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/[\s(,–-]+$/, "").trim();
  }

  function splitTopLevel(s) {
    const parts = []; let depth = 0, last = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const rest = s.slice(i);
        const m = ch === "," ? [","] : rest.match(/^(\s+und\s+|\s*&\s*|\s+and\s+)/);
        if (m && (ch === "," || /^\s/.test(rest) || ch === "&")) {
          parts.push(s.slice(last, i)); i += m[0].length - 1; last = i + 1;
        }
      }
    }
    parts.push(s.slice(last));
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  /** Deutscher Zutatenname endet am Hauptwort; was klein dahinter folgt, ist Zusatz:
   *  „Hackfleisch halb Rind und halb Schwein“, „Zwiebeln ca. 2-3 Stück“, „Nudeln nach Wahl z.B. …“ */
  function splitHead(s) {
    const toks = s.split(/\s+/).filter(Boolean);
    const cap = (w) => /^[A-ZÄÖÜ]/.test(w);
    let i = toks.findIndex(cap);
    if (i < 0) return null;
    for (;;) {
      const nx = toks[i + 1];
      if (!nx) return null;
      if (cap(nx) || /^\d+$/.test(nx) || /^(fraîche|fraiche)$/i.test(nx)) { i++; continue; }
      // „Salz und schwarzer Pfeffer“, „Sonnenblumen- oder Rapsöl“, „Mozzarella di Bufala“
      const j = toks.slice(i + 2, i + 4).findIndex(cap);
      if (/^(und|oder|&|di|del|della|alla|al|con|de|du)$/.test(nx) && j >= 0 && toks.slice(i + 2, i + 2 + j).every((w) => /^[a-zäöüß]+(e|en|er|es|em)$/.test(w))) { i += 2 + j; continue; }
      break;
    }
    return { name: toks.slice(0, i + 1).join(" "), note: toks.slice(i + 1).join(" ") };
  }

  function multiIngredient(s) {
    const parts = splitTopLevel(s);
    if (parts.length < 2) return null;
    const allLower = s === s.toLowerCase();
    for (const p of parts) {
      let core = p.replace(/\([^)]*\)/g, "").trim();
      const sh = splitHead(core);
      if (sh) core = sh.name;
      const ws = core.split(/\s+/).filter(Boolean);
      const own = ws.filter((w) => !lex.ADJ.has(w.toLowerCase()));
      if (!own.length || own.length > 2 || /\d/.test(core)) return null;
      // „frisch gehackt“ ohne Hauptwort ist ein Zusatz, keine eigene Zutat; „schwarzer Pfeffer“ zählt
      if (!(/^[A-ZÄÖÜ]/.test(own[0]) || (allLower && ws.length === 1))) return null;
    }
    return parts;
  }

  // Englische Zubereitungsangabe hinter dem Namen: „1 onion finely chopped“, „2 garlic cloves crushed“
  const EN_PREP = /^(.*?[a-z])\s+((?:(?:finely|roughly|thinly|coarsely|freshly|lightly)\s+)?(?:chopped|sliced|diced|minced|crushed|grated|peeled|halved|quartered|deseeded|seeded|drained|rinsed|trimmed|softened|melted|beaten|sifted|torn|shredded|cubed|picked|cut)\b.*)$/;

  function parseIngredientLine(line) {
    // Markdown-Aufgabe „- [ ] …“, Hervorhebung „_optional:_“, Mengen anderer Portionsgrößen „[15 g | 20 g]“,
    // Vorrats-Sternchen „Öl*“, Allergen-Nummern „Parmesan (7)“
    let s = line.trim().replace(/^[*•·\-–▢☐□◻◽▪■○●◦✓✔☑]\s*/, "").replace(/^\[[ xX]?\]\s*/, "").replace(/\*\*/g, "")
      .replace(/(^|\s)_([^_]+)_(?=\s|$|[:,])/g, "$1$2").replace(SIZE_VARIANTS, "").replace(/(\S)\*+(?=\s|,|$)/g, "$1")
      .replace(/\s*\(\d+(?:\s*,\s*\d+)*\)/g, "").trim();
    // „2 x 400g tins chopped tomatoes“ → 2 tins (400g); „400g tin kidney beans“ → 1 tin (400g)
    s = s.replace(/^(\d+)\s*[x×]\s*(\d+\s*(?:g|ml|oz))\s+(tins?|cans?|dosen?)\b/i, "$1 $3 ($2)").replace(/^(\d+\s*(?:g|ml|oz))\s+(tins?|cans?)\b/i, "1 $2 ($1)");
    let optional = false;
    const om = s.match(/^(optional|nach belieben|evtl\.?|wahlweise|nach geschmack)\s*:?\s*/i);
    if (om) { optional = true; s = s.slice(om[0].length); }
    if (/\(\s*optional\s*\)|,\s*optional\s*$|\bnach belieben\b|\(?nach geschmack\)?$/i.test(s)) {
      optional = true;
      s = s.replace(/\(\s*optional\s*\)|,\s*optional\s*$|,?\s*nach belieben|,?\s*\(?nach geschmack\)?$/gi, "").trim();
    }
    const qm = s.match(new RegExp("^(?:ca\\.|etwa|circa)?\\s*(" + M.NUM_RE + "(?:\\s*(?:-|–|bis)\\s*" + M.NUM_RE + ")?)(?![\\d])\\s*", "i"));
    let qty = null, unit = "", amountWord = false;
    if (qm && qm[1].trim()) { qty = M.parseQty(qm[1]); s = s.slice(qm[0].length); }
    else {
      const wm = s.match(QTY_WORD);
      if (wm && s.slice(wm[0].length).trim()) {
        if (/^n/i.test(wm[1])) optional = true; else { unit = wm[1].toLowerCase(); amountWord = true; }
        s = s.slice(wm[0].length);
      }
    }
    // Chefkoch: „Kartoffel(n)“, „Zehe/n“, „m.-große“
    const plural = !!(qty && qty.max > 1);
    s = s.replace(/([a-zäöüß])(?:\((n|en|e|s|er|nen)\)|\/(n|en|e|s)(?![a-zäöüß]))/g, (_, ch, a, b) => ch + (plural ? a || b : ""))
      .replace(/(^|\s)m\.-\s*(?=gro)/i, "$1mittel");
    const um = s.match(/^([A-Za-zÄÖÜäöüß]+\.?)(?=\s|$|,)/);
    if (!unit && um && lex.UNIT_MAP[um[1].toLowerCase()] && (qty || /^(prise|msp|schuss|pinch)/i.test(um[1]))) {
      const rest = s.slice(um[0].length).trim();
      if (rest) { unit = um[1]; s = rest; }
    }
    if (!qty && (!unit || amountWord)) {
      const parts = multiIngredient(s);
      if (parts) return parts.flatMap((p) => parseIngredientLine(p).map((z) => Object.assign(z, { unit: z.unit || unit, optional: z.optional || optional, line: line.trim() })));
    }
    const notes = [];
    s = s.replace(/\(([^)]*)\)/g, (_, x) => { if (x.trim()) notes.push(x.trim()); return " "; }).replace(/\s+/g, " ").trim();
    let name = s, note = "";
    const ci = s.indexOf(",");
    if (ci >= 0) { name = s.slice(0, ci).trim(); note = s.slice(ci + 1).trim(); }
    const fm = name.match(/\s+(für|zum|zur|zu|for)\s+.+$/i);
    if (fm) { note = [fm[0].trim(), note].filter(Boolean).join(", "); name = name.slice(0, fm.index).trim(); }
    // „Salz/Jodsalz“, „Parmesan/Grana Padano“ (WW): die zweite Angabe ist eine Alternative
    const sl = name.match(/^([A-ZÄÖÜ][\wäöüß-]*)\/([A-ZÄÖÜ].*)$/);
    if (sl) { name = sl[1]; note = [sl[2], note].filter(Boolean).join(", "); }
    const sh = splitHead(name);
    const en = !sh && name.match(EN_PREP);
    if (sh) { note = [sh.note, note].filter(Boolean).join(", "); name = sh.name; }
    else if (en) { note = [en[2], note].filter(Boolean).join(", "); name = en[1]; }
    // „2 garlic cloves“, „3 rosemary sprigs“: englische Einheit hinter dem Namen
    const eu = !unit && !sh && name.match(/^([a-z][a-z ]*?)\s+(cloves?|sprigs?|sticks?|stalks?|rashers?)$/);
    if (eu) { unit = eu[2]; name = eu[1]; }
    // Größe gehört nicht zum Namen: „mittelgroße Kartoffeln“
    const sz = name.match(/^((?:sehr\s+)?(?:mittel)?(?:groß|gross|klein)(?:e|er|es|en)?)\s+(?=[A-ZÄÖÜ])/);
    if (sz) { note = [sz[1], note].filter(Boolean).join(", "); name = name.slice(sz[0].length); }
    if (!unit && /^[A-ZÄÖÜ][a-zäöüß]+zehen?$/.test(name) && name.length > 7) {
      unit = qty && qty.max > 1 ? "Zehen" : "Zehe";
      name = cap(name.replace(/zehen?$/i, ""));
    }
    return [{ id: "", qty, unit, name: name || s || line.trim(), note: [note, ...notes].filter(Boolean).join(", "), optional, missing: false, line: line.trim() }];
  }

  const isListLine = (t) => BULLET_RE.test(t) || /^\d/.test(t) || /^[½¼¾⅓⅔]/.test(t);
  const isNumberedStep = (t) => /^\d+\s*[.)]\s+/.test(t);
  const endsSentence = (t) => /[.!?…]["“”»)]?$/.test(t);

  const AMOUNT_ONLY = new RegExp("^(?:ca\\.\\s*)?" + M.NUM_RE + "(?:\\s*(?:-|–|bis)\\s*" + M.NUM_RE + ")?(?:\\s+(\\S+(?:\\s+\\S+)?))?$", "i");
  /** "strong": Zeile ist sicher nur eine Menge („2 EL“, „1“, „etwas“); "weak": vielleicht („6 m.-große“, aber auch „2 Eier“). */
  function amountOnly(t) {
    if (QTY_WORD.test(t) && !t.replace(QTY_WORD, "")) return "strong";
    const m = t.replace(/\((?:n|en|e|s)\)/g, "").match(AMOUNT_ONLY);
    if (!m) return "";
    return !m[1] || lex.UNIT_MAP[m[1].toLowerCase()] ? "strong" : "weak";
  }

  /** Chefkoch und ähnliche Seiten setzen Menge, Zutat und Zusatz in eigene Zeilen
   *  („2 EL“ / „Margarine“, „1 Pck.“ / „Sahne“ / „oder Sojasahne, ca. 200 ml“). Erkannt wird das
   *  an mehreren Zeilen, die nur aus einer Menge bestehen; dann werden die Teile zusammengesetzt.
   *  Cookidoo und WW stellen den Namen voran („Zwiebel“ / „halbiert“ / „1“, „Knoblauch“ / „1 Zehe(n)“),
   *  Cookidoo zudem die Einheit in eine eigene Zeile („20“ / „g“). */
  function joinSplitLines(texts) {
    const ts = [];
    for (const t of texts.map((x) => x.trim())) {
      const p = ts[ts.length - 1];
      if (p && /^\d+(?:[,.]\d+)?(?:\s*[-–]\s*\d+(?:[,.]\d+)?)?$/.test(p) && lex.UNIT_MAP[t.toLowerCase()]) ts[ts.length - 1] = p + " " + t;
      else ts.push(t);
    }
    // Menge hinter dem Namen, wahlweise mit Zusatz („1 Stück, mittelgroß“): erste Zeile ein Name, letzte eine Menge
    const heads = ts.map((t) => amountOnly(t.split(/,\s*/)[0]));
    if (ts.length > 2 && !heads[0] && heads[heads.length - 1] && heads.filter((k) => k === "strong").length >= 2) return nameFirst(ts, heads);
    const kinds = ts.map(amountOnly);
    const nameAt = (i) => i < ts.length && !kinds[i];
    if (kinds.filter((k, i) => k === "strong" && nameAt(i + 1)).length < 2) return ts;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (kinds[i]) {
        if (nameAt(i + 1)) out.push(ts[i] + " " + ts[++i]);
        else if (kinds[i] === "weak") out.push(ts[i]);
        // sonst Menge ohne Zutat, etwa der Portionswähler („4“)
      } else if (/^[a-zäöüß(]/.test(ts[i]) && out.length) out[out.length - 1] += ", " + ts[i];
      else out.push(ts[i]);
    }
    return out;
  }

  /** Name vor der Menge: der erste Name gehört zur Menge, kleingeschriebene Zeilen danach sind Zusätze,
   *  großgeschriebene eigene Zutaten ohne Menge. */
  function nameFirst(ts, kinds) {
    const out = [];
    let names = [];
    for (let i = 0; i < ts.length; i++) {
      if (!kinds[i]) { names.push(ts[i]); continue; }
      const [amount, ...tail] = ts[i].split(/,\s*/);
      const groups = [];
      for (const n of names) if (!groups.length || /^[A-ZÄÖÜ]/.test(n)) groups.push([n]); else groups[groups.length - 1].push(n);
      const own = groups.pop() || [];
      for (const g of groups) out.push(g.join(", "));
      const extra = own.slice(1).concat(tail).map((x) => x.replace(/^\((.*)\)$/, "$1"));
      out.push([(amount + " " + (own[0] || "")).trim(), ...extra].join(", "));
      names = [];
    }
    return out.concat(names);
  }

  /** „20Minuten Min.“ → „20 Min.“, „1Stunde Std.“ → „1 Std.“ */
  function timeValue(v) {
    const out = []; let m;
    const re = /(\d+(?:[,.]\d+)?)\s*(stunden?|std\.?|hours?|hrs?|h\b|minuten?|min\.?)/gi;
    while ((m = re.exec(v))) out.push(m[1] + (/^(s|h)/i.test(m[2]) ? " Std." : " Min."));
    return out.length ? out.join(" ") : v.trim();
  }

  /** Bildunterschriften von Rezeptseiten zwischen den Absätzen: kurze Zeile ohne Satzzeichen und
   *  ohne gebeugtes Verb direkt nach einem Satz, in einem Text, der sonst aus Sätzen besteht. */
  function dropCaptions(stepLines) {
    const ts = stepLines.map((L) => L.text.trim());
    if (ts.length < 4 || ts.filter(endsSentence).length * 2 < ts.length) return stepLines;
    return stepLines.filter((L, i) => {
      const t = ts[i];
      if (!i || isNumberedStep(t) || BULLET_RE.test(t) || /[.!?…:;)]$/.test(t) || !endsSentence(ts[i - 1]) || t.length > 100 || OVEN_SET.test(t)) return true;
      const v = findVerb(t, { guess: false });
      return !!(v && v.finite);
    });
  }

  // ---- Hauptfunktion --------------------------------------------------------------------

  function parse(text) {
    const model = M.emptyModel();
    const src = String(text || "").replace(/\r\n?/g, "\n");
    model.source = src;
    // Emojis stören die Erkennung („🛒 Zutaten:“, „1️⃣ …“). Gleich lang ersetzen, damit die Textstellen zur Quelle passen.
    const plain = src.replace(/(\d)\uFE0F?\u20E3/g, (m, d) => d + "." + " ".repeat(m.length - 2))
      .replace(PICTO, (m) => (KEEP_SIGNS.includes(m) ? m : " ".repeat(m.length)));
    const lines = []; let off = 0;
    for (const l of plain.split("\n")) { lines.push({ text: l, start: off }); off += l.length + 1; }

    const cleanOf = (t) => t.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:\s*$/, "").trim();
    // „Für die Soße:“ ist eine Überschrift, „Für die Soße die Zwiebel würfeln.“ nicht
    const isIngHdr = (c, t) => ING_HDR.test(c) && c.length < 60 &&
      (!/^für\b/i.test(c) || /:$/.test(t) || (c.split(/\s+/).length <= 4 && !endsSentence(c) && !findVerb(c, { guess: false })));
    // „Zubereitung“, „Zubereitung (ca. 30 Min.)“: Überschrift; „Zubereitung 10 Min.“: vielleicht nur eine Zeitangabe; „Method: Oven“: keins
    const stepHdr = (c) => {
      const m = c.match(STEP_HDR);
      if (!m || c.length >= 80) return "";
      const rest = c.slice(m[0].length).replace(/^\s*:?\s*/, "");
      return !rest || /^\(/.test(rest) ? "plain" : TIME_ONLY.test(rest) ? "time" : "";
    };
    const cleans = lines.map((L) => cleanOf(L.text.trim()));
    const hasHeader = lines.some((L, i) => isIngHdr(cleans[i], L.text.trim()) || stepHdr(cleans[i]));
    // nur „Zutaten“ selbst; vor „Für die Soße:“ kann schon die erste Zutatenliste stehen
    const firstIng = lines.findIndex((L, i) => /^(zutaten|ingredients|einkaufsliste)\b/i.test(cleans[i]) && isIngHdr(cleans[i], L.text.trim()));
    const nextLine = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].text.trim()) return j; return -1; };
    // Folgt noch eine echte Überschrift oder Schrittmarke, ist „Zubereitung 10 Min.“ eine Kopfangabe (Kitchen Stories, Cookidoo)
    const laterSteps = (i) => cleans.some((c, j) => j > i && (STEP_MARK.test(c) || stepHdr(c) === "plain"));
    const timeLabel = (s) => META_TIME_LABEL[s.toLowerCase().replace(/\s+/g, "")] || s;

    let mode = null, titleDone = false, metaLabel = null, prevClean = "";
    const ingLines = [], stepLines = [], noteLines = [], times = [], skip = new Set();
    const addTime = (name, v) => { const tv = timeValue(v); if (/[1-9]/.test(tv)) times.push(name + " " + tv); };
    const setServings = (v) => { if (!model.servings) model.servings = parseFloat(v); };
    /** Eine Kopfangabe; true, wenn die Zeile damit erledigt ist. */
    const meta1 = (c, i) => {
      const tm = c.match(META_TIME);
      if (tm) {
        const name = timeLabel(tm[1]);
        if (tm[2].trim()) addTime(name, tm[2]); else metaLabel = { kind: "time", name };
        return true;
      }
      const sm = c.match(META_SHORT);
      if (sm && TIME_ONLY.test(sm[2].trim())) { addTime(timeLabel(sm[1]), sm[2]); return true; }
      if (TIME_ONLY.test(c) && i != null) {
        const j = nextLine(i), nm = j >= 0 && cleans[j].match(META_TIME);
        if (nm && !nm[2].trim()) { addTime(timeLabel(nm[1]), c); skip.add(j); return true; }
      }
      const sv = c.match(SERV_LINE);
      if (sv) { setServings(sv[1]); return true; }
      if (SERV_LABEL.test(c)) { metaLabel = { kind: "servings" }; return true; }
      if (META_OTHER.test(c)) {
        servingsFrom(c, model);
        // Bezeichnung allein („Schwierigkeitsgrad“, „Kalorien:“): der Wert steht in der nächsten Zeile
        if (c.split(/\s+/).length <= 3 && !/[\d:]/.test(c)) metaLabel = { kind: "skip" };
        return true;
      }
      return false;
    };
    // mehrere Angaben in einer Zeile: „Gesamtzeit: 30 Min • Portionen: 2“, „Arbeitszeit: ca. 20 Min. / Koch-/Backzeit: …“
    const metaLine = (c, i) => {
      const segs = c.split(/\s+[•|\/]\s+/);
      if (segs.length > 1 && meta1(segs[0])) { segs.slice(1).forEach((x) => meta1(x)); return true; }
      return meta1(c, i);
    };

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const t = L.text.trim();
      if (!t || skip.has(i) || HASHTAGS.test(t)) continue;
      const clean = cleans[i], prevC = prevClean;
      prevClean = clean;
      // Wert zur Bezeichnung der Zeile davor
      if (metaLabel) {
        const ml = metaLabel; metaLabel = null;
        if (ml.kind === "time" && /\d/.test(t) && t.length < 40) { addTime(ml.name, t); continue; }
        if (ml.kind === "servings" && /^\d+$/.test(clean)) { setServings(clean); continue; }
        if (ml.kind === "skip" && clean.length < 30 && !isIngHdr(clean, t) && !stepHdr(clean)) continue;
      }
      if (mode === "end") {
        if (stepLines.length) continue;
        if (!isIngHdr(clean, t) && !stepHdr(clean) && !STEP_MARK.test(clean)) { metaLine(clean, i); continue; }
        mode = null;
      }
      if (UI_NOISE.test(clean) || /^(für|for)$/i.test(clean)) continue;
      // „Nutrition“ direkt unter „Ingredients“ ist ein Reiter (BBC), kein Ende
      if (END_HDR.test(clean) && clean.length < 80) { if (mode !== "ing" || ingLines.length) mode = "end"; continue; }
      if (isIngHdr(clean, t)) { mode = "ing"; metaLabel = null; servingsFrom(clean, model); continue; }
      const sh = stepHdr(clean);
      if (sh && !(laterSteps(i) && (sh === "time" || TIME_ONLY.test(cleans[nextLine(i)] || "")))) {
        mode = "steps"; metaLabel = null;
        const pm = clean.match(/\(([^)]*)\)/) || clean.match(/:\s*(.+)$/);
        if (pm && !times.length) model.statedTime = pm[1].trim();
        continue;
      }
      if (sh === "plain") { metaLabel = { kind: "time", name: timeLabel(clean) }; continue; }
      if (STEP_MARK.test(clean)) { mode = "steps"; stepLines.push(L); continue; }
      if (EQUIP_HDR.test(clean)) { mode = "equip"; continue; }
      if (NOTES_HDR.test(clean) && stepLines.length) { mode = "notes"; continue; }
      if (mode === "equip") continue;
      if (mode === "notes") { if (!metaLine(clean, i)) noteLines.push(L); continue; }
      // „2“ / „Portionen“: die Zahl davor ist die Portionenzahl, keine Zutat
      if (SERV_WORD.test(clean) && /^\d+$/.test(prevC)) {
        setServings(prevC);
        if (ingLines.length && ingLines[ingLines.length - 1].text.trim() === prevC) ingLines.pop();
        continue;
      }
      // Kopfangaben stehen auch direkt unter „Zubereitung“, vor dem ersten Schritt
      if (mode !== "steps" || !stepLines.length) { if (metaLine(clean, i)) continue; }
      else if (META_OTHER.test(clean) && clean.split(/\s+/).length <= 2 && !/\d/.test(clean)) { metaLabel = { kind: "skip" }; continue; }
      if (!titleDone && mode === null && !isListLine(t)) {
        // „Für 4 Portionen“ ohne Titel: nur die Portionen lesen
        const title = servingsFrom(clean, model);
        if (title) { model.title = title; titleDone = true; }
        continue;
      }
      if (mode === "ing") {
        // Gruppen („Rührteig:“, „Zum Bestäuben:“, „For the chilli“, „To serve“), Allergene, verklebte Linklisten
        const group = !/\d/.test(clean) && clean.split(/\s+/).length <= 5 && (/:$/.test(t.replace(/\*+$/, "")) || /^(for the|to serve|for serving|to garnish|for garnish)\b/i.test(clean));
        if (group || /^\((?:enthält|kann spuren)/i.test(clean) || (!/\s/.test(clean) && (clean.match(/[a-zäöüß][A-ZÄÖÜ]/g) || []).length >= 2)) continue;
        ingLines.push(L);
      }
      else if (mode === "steps") stepLines.push(L);
      else if (isNumberedStep(t)) stepLines.push(L);
      // Aufzählung vor der Zutaten-Überschrift ist Einleitung („Why It Works“, Bewertungen, Kalorien)
      else if (isListLine(t)) { if (i > firstIng) ingLines.push(L); }
      // ohne Überschriften: kurze Zeile ohne Satzzeichen und Verb im Zutatenblock ist eine Zutat („Salz“)
      else if (!hasHeader && ingLines.length && !stepLines.length && t.length < 40 && !endsSentence(t) && !findVerb(t, { guess: false })) ingLines.push(L);
      else if (!hasHeader) stepLines.push(L);
      // sonst: Einleitungstext vor der ersten Überschrift
    }
    if (times.length) model.statedTime = times.join(", ");
    if (!model.title) model.title = "Rezept";

    for (const text of joinSplitLines(ingLines.map((L) => L.text))) {
      for (const z of parseIngredientLine(text)) { z.id = M.newId(model, "z"); model.ingredients.push(z); }
    }
    for (const z of model.ingredients) z._keys = M.keysFor(z.name);

    // Zwischenüberschrift (Dr. Oetker: „Vorbereiten“, „Rührteig zubereiten“): kurz, ohne Zutat, vor einem Absatz
    const heading = (L, i) => {
      const h = L.text.trim(), nx = stepLines[i + 1] && stepLines[i + 1].text.trim();
      if (h.length > 30 || h.split(/\s+/).length > 3 || /[\d.!?…;,()/]/.test(h) || BULLET_RE.test(h) || !nx || !endsSentence(nx) || nx.length < 30) return false;
      return !words(h).some((w) => !lex.V[w.lw] && model.ingredients.some((z) => z._keys.some((k) => M.tokenMatchesKey(w.lw, k))));
    };
    let heads = stepLines.filter(heading);
    if (heads.length < 2) heads = heads.filter((L) => /:$/.test(L.text.trim()));
    // Schrittnummer allein auf einer Zeile („1“ / „Zuerst …“), Schrittmarke, Zwischenüberschrift
    const numberedNext = new Set();
    const bodyLines = stepLines.filter((L, i) => {
      if (!/^\s*\d+\s*[.)]?\s*$/.test(L.text) && !STEP_MARK.test(cleanOf(L.text.trim())) && !heads.includes(L)) return true;
      if (stepLines[i + 1]) numberedNext.add(stepLines[i + 1]);
      return false;
    });
    // Mit Schrittmarken gehören alle Zeilen bis zur nächsten Marke zum selben Schritt (HelloFresh: ein Satz je Zeile)
    const marked = numberedNext.size > 0;
    const st = { model, holder: new Map(), consumed: new Set(), prev: null, pendingNotes: [], equip: new Map(), n: 0, mediumAt: new Map(), medium: new Map() };
    for (const L of dropCaptions(bodyLines)) {
      // „1Aubergine …“: Nummer ohne Punkt direkt am Text (lecker.de)
      const lead = L.text.match(/^\s*(?:(\d+)\s*[.)]|(\d+)(?=[A-ZÄÖÜ][a-zäöüß])|[*•·\-–▢☐□◻◽▪■○●◦✓✔☑])?\s*/);
      // Fettdruck, Mengen anderer Portionsgrößen und Vorrats-Sternchen gleich lang ausblenden
      const body = L.text.slice(lead[0].length).replace(/\*\*|__/g, "  ").replace(SIZE_VARIANTS, (m) => " ".repeat(m.length)).replace(/(\S)\*(?=[\s,.;:]|$)/g, "$1 ");
      if (!body.trim()) continue;
      // Tipp-Absatz: alles darin ist Hinweis zum vorigen Schritt, auch Sätze mit Verben
      const tip = body.match(TIP_RE);
      if (tip && !lead[1] && !lead[2]) { attach(st, "note", body.slice(tip[0].length).trim()); continue; }
      if (ovenSetting(st, body)) continue;
      const numbered = !!(lead[1] || lead[2]) || numberedNext.has(L) || /^\s*[*•·\-–▢☐□◻◽▪■○●◦✓✔☑]/.test(L.text);
      if (numbered || !st.n || (!marked && /^[A-ZÄÖÜ]/.test(body))) st.n++;
      processItem(st, body.replace(/\s+$/, ""), L.start + lead[0].length);
    }
    // Anmerkungen nach der Zubereitung gehören zum fertigen Gericht
    const dish = model.steps[model.steps.length - 1];
    if (dish) for (const L of noteLines) appendField(dish, "note", L.text.trim().replace(BULLET_RE, ""));
    for (const z of model.ingredients) delete z._keys;
    return model;
  }

  /** „Ober-/Unterhitze: etwa 180 °C“ unter „Backofen vorheizen.“: Temperatur des Vorheizens, weitere Varianten als Hinweis. */
  function ovenSetting(st, body) {
    const m = body.trim().match(OVEN_SET);
    if (!m) return false;
    const pre = st.model.steps.slice().reverse().find((s) => /^(vorheizen|preheat)$/.test(s.verb));
    const tm = m[2].match(TEMP_RE);
    if (pre && tm && !pre.temp) {
      pre.temp = tm[1] + " °" + (tm[2] || "C").toUpperCase();
      pre.detail = [pre.detail, m[1]].filter(Boolean).join(", ");
    } else if (pre) appendField(pre, "note", body.trim());
    else attach(st, "note", body.trim());
    return true;
  }

  function processItem(st, text, absStart) {
    // Zwischentitel vor dem Schritt („Gemüse schneiden: Zwiebel … würfeln“) ist keine Handlung, wenn danach ein eigenes Verb folgt;
    // „Würfeln: Zwiebel, Paprika“ bleibt eine Handlung (siehe processSentence)
    const lm = text.match(/^\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*(?:\s+[\wÄÖÜäöüß-]+){0,3})\s*:\s+/);
    if (lm && !/^(tipp|tip|hinweis|info|achtung|wichtig|note|anmerkung)$/i.test(lm[1]) && findVerb(text.slice(lm[0].length), { guess: false })) {
      text = " ".repeat(lm[0].length) + text.slice(lm[0].length);
    }
    const prot = text.replace(ABBR_RE, (m) => m.slice(0, -1) + "\u0001");
    const bounds = []; let last = 0, m;
    const bre = /[.!?]+(?:\s+|$)/g;
    while ((m = bre.exec(prot))) { const end = m.index + m[0].length; bounds.push([last, end]); last = end; }
    if (last < prot.length) bounds.push([last, prot.length]);
    bounds.forEach(([a, b], i) => {
      const raw = text.slice(a, b);
      const lead = raw.length - raw.trimStart().length;
      const sentence = raw.trim();
      if (sentence) processSentence(st, sentence, absStart + a + lead, i === 0);
    });
  }

  function lastStep(st) { return st.prev; }
  function appendField(step, field, text) {
    text = text.replace(/[.!?]+$/, "").trim();
    if (!text) return;
    step[field] = step[field] ? step[field] + "; " + text : text;
  }
  function attach(st, field, text) {
    const s = lastStep(st);
    if (s) appendField(s, field, text);
    else st.pendingNotes.push([field, text]);
  }

  const blank = (s, a, b) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b);

  /** Garpunkt „bis goldbraun“; „bei mittlerer bis kleiner Hitze“ ist nur eine Spanne. */
  function findCue(s) {
    const re = /,?\s*\b(bis|until)\s+(?!\d)/gi; let m;
    while ((m = re.exec(s))) {
      const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
      if (/\b(mittlere[rn]?|kleine[rn]?|schwache[rn]?|niedrige[rn]?|starke[rn]?|hohe[rn]?|mäßige[rn]?|mittel)\s*$/i.test(before) || /^\S+\s+(Hitze|Stufe|Flamme|Temperatur)\b/i.test(after)) continue;
      const rest = after.match(/^(.+?)(?=,\s*(?:dann|danach|anschließend|then)\b|$)/);
      if (rest) return { a: m.index, b: m.index + m[0].length + rest[0].length, text: rest[1].trim() };
    }
    return null;
  }

  /** „Dabei ab und zu umrühren“, „falls nötig etwas Wasser zugeben“: Hinweis zum vorigen Schritt. */
  function isAside(text) {
    const t = text.trim();
    if (ASIDE_COND.test(t)) return true;
    const v = findVerb(t, { guess: false });
    return !!(v && STIR.has(v.key) && OCCASIONAL.test(t) && !/\d/.test(t) && !words(t).slice(1).some((w) => /^[A-ZÄÖÜ]/.test(w.w)));
  }

  function processSentence(st, sentence, absStart, firstInItem) {
    const s = sentence.replace(/[.!?]+\s*$/, "");
    if (CHATTER.test(s)) return;
    if (/^\(.*\)$/.test(s)) { attach(st, "note", s.slice(1, -1).trim()); return; }
    if (/wiederhol|repeat/i.test(s) && !findVerb(s.replace(/wiederhol\w*|repeat\w*/gi, ""))) {
      const rep = s.match(/(\d+)(?:\s*(?:-|–|bis)\s*(\d+))?\s*(?:-?\s*mal|x|×|times)\b/i);
      const target = lastStep(st);
      if (target) target.repeat = rep ? rep[1] + (rep[2] ? "–" + rep[2] : "") : "mehrmals";
      return;
    }
    if (/^(nicht|kein|keine|keinen|tipp|hinweis|wichtig|achtung|tip|note|don'?t|do not|never)\b/i.test(s)) { attach(st, "note", s); return; }

    const lab = s.match(/^([A-Za-zÄÖÜäöüß]+)\s*:\s*/);
    if (lab) {
      const lv = lab[1].toLowerCase();
      if (lex.V[lv]) {
        makeAction(st, { text: s, offset: lab[0].length, labelVerb: lv, join: firstInItem ? "new" : "sentence", cue: "", src: sentence, absStart, ovenSentence: false });
        return;
      }
      if (/^(tipp|hinweis|info|achtung|wichtig|tip|note)$/i.test(lab[1])) { attach(st, "note", s.slice(lab[0].length)); return; }
    }

    let cue = "", core = s;
    const cm = findCue(s);
    if (cm) { cue = cm.text; core = blank(s, cm.a, cm.b); }
    // Begründung („…, damit das Gemüse mit Fett überzogen wird“) ist ein Hinweis, keine Handlung
    let reason = "";
    const rm = core.match(/,\s*(?:damit|weil|sodass|so dass|denn)\s+.+?(?=,\s*(?:dann|danach|anschließend|then)\b|$)/i);
    if (rm) { reason = rm[0].replace(/^,\s*/, "").trim(); core = blank(core, rm.index, rm.index + rm[0].length); }
    // Relativsatz („…, in der Kartoffeln und Brokkoli gekocht wurden, …“) sagt nur, was gemeint ist
    core = core.replace(/,\s*(?:(?:in|mit|aus|auf|von)\s+)?(?:der|dem|denen|die|das|welche[mnrs]?)\s+[^,]*?\b(?:wurden?|worden|ist|sind|hat|haben|war|waren)\s*(?=,|$)/gi, (x) => " ".repeat(x.length));

    if (!findVerb(core, { guess: false })) {
      if (/\b(soll|sollte|sollen|muss|müssen|should|must)\b/i.test(core)) { attach(st, "cue", core.trim()); return; }
      if (!findVerb(core)) { attach(st, "note", [core.trim(), reason].filter(Boolean).join(", ")); return; }
    }

    const SEP = /\s*,\s+(?:(?:dann|danach|anschließend|und dann|then)\s+)?|\s*;\s*|\s+(?:und|and)\s+(?:(?:dann|then)\s+)?|\s+(?:dann|danach|then)\s+/gi;
    const segs = []; let last = 0, join = firstInItem ? "new" : "sentence", m;
    while ((m = SEP.exec(core))) {
      segs.push({ a: last, b: m.index, join });
      join = /und|and|dann|danach|anschließend|then/i.test(m[0]) ? "und" : ",";
      last = m.index + m[0].length;
    }
    segs.push({ a: last, b: core.length, join });
    // fehlendes „und“ zwischen zwei Infinitiven: „die Kartoffeln in Würfel schneiden in der Brühe gar kochen“
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i], ws = words(core.slice(g.a, g.b));
      const inf = (w) => w && w.w === w.lw && lex.V[w.lw] && w.lw !== "lassen";
      const k = ws.findIndex((w, j) => {
        if (!j || !inf(w) || ws[j - 1].lw === "zu") return false;
        const j2 = ws.findIndex((x, n) => n > j && inf(x));
        // „hacken oder pressen“ ist eine Wahl, keine zwei Handlungen
        return j2 > j + 1 && !ws.slice(j + 1, j2).some((x) => /^(oder|bzw|or|beziehungsweise|lassen)$/.test(x.lw));
      });
      if (k < 0) continue;
      const cut = g.a + ws[k].i + ws[k].w.length;
      segs.splice(i, 1, { a: g.a, b: cut, join: g.join }, { a: cut, b: g.b, join: "und" });
    }
    // Infinitiv am Ende („Zwiebeln schälen, Knoblauch hacken“): Teile davor gehören zum Verb.
    // Gebeugtes Verb vorn („gibst du die Butter, die Zwiebeln … in den Topf“) und Englisch („Add the tomatoes and beans“): Teile danach gehören dazu.
    const groups = []; let pending = [], openFinite = false;
    for (const g of segs) {
      const t = core.slice(g.a, g.b);
      if (!t.trim()) continue;
      const v = findVerb(t);
      if (!v && openFinite) { groups[groups.length - 1].push(g); continue; }
      pending.push(g);
      if (v) { groups.push(pending); pending = []; openFinite = v.finite || v.en; }
    }
    if (pending.length) { if (groups.length) groups[groups.length - 1].push(...pending); else groups.push(pending); }

    const ovenSentence = s.split(/\s+/).some((w) => lex.OVEN.has(w.toLowerCase().replace(/[^a-zäöüß]/g, "")));
    groups.forEach((grp, k) => {
      const a = grp[0].a, b = grp[grp.length - 1].b, isLast = k === groups.length - 1;
      if (isAside(core.slice(a, b))) {
        attach(st, "note", core.slice(a, b).trim());
        if (isLast && cue) attach(st, "cue", cue);
        return;
      }
      makeAction(st, {
        text: core.slice(a, b), offset: 0, join: k === 0 ? grp[0].join : grp[0].join,
        cue: isLast ? cue : "", src: sentence.slice(a, isLast ? sentence.length : b).trim(),
        absStart: absStart + a, ovenSentence
      });
    });
    if (reason) attach(st, "note", reason);
  }

  // ---- Erwähnungen ------------------------------------------------------------------------

  function portionBefore(body, pos) {
    const ws = body.slice(Math.max(0, pos - 48), pos).split(/\s+/).filter(Boolean).slice(-3).map((w) => w.toLowerCase().replace(/[^a-zäöüß½¼¾⅓⅔0-9,./]/g, ""));
    for (let k = ws.length; k >= 1; k--) {
      const tail = ws.slice(-k).join(" ");
      for (const [re, label, kind] of lex.PORTION_WORDS) {
        const mm = tail.match(re);
        if (mm && mm.index === 0) {
          const after = tail.slice(mm[0].length).trim();
          if (!after || /^(der|des|von|vom|of|the|an)$/.test(after)) {
            const text = label || mm[0].replace(/^(den|dem|der|die|das)\s+/, "");
            return { text, kind };
          }
        }
      }
    }
    const w1 = ws[ws.length - 1], w2 = ws[ws.length - 2];
    const numOf = (w) => (w == null ? null : NUMBER_WORDS[w] != null ? NUMBER_WORDS[w] : /^\d+(?:[,.]\d+)?$|^[½¼¾⅓⅔]$/.test(w) ? w : null);
    // Menge mit Einheit: „mit 1 TL Salz“, „einem 1/4 TL schwarzen Pfeffer“, „eine Messerspitze geriebene Muskatnuss“
    let j = ws.length - 1;
    while (j > 0 && ws.length - j <= 2 && /^[a-zäöüß]+(e|en|er|es|em)$/.test(ws[j]) && !lex.UNIT_MAP[ws[j]]) j--;
    const unit = lex.UNIT_MAP[ws[j]] || lex.UNIT_MAP[(ws[j] || "") + "."];
    const amount = j > 0 && (NUMBER_WORDS[ws[j - 1]] != null ? NUMBER_WORDS[ws[j - 1]] : /^\d/.test(ws[j - 1]) ? (M.parseQty(ws[j - 1]) || {}).min : null);
    if (unit && amount) return { text: M.fmtNum(amount, unit) + " " + unit, kind: "amount", n: amount, unit };
    if (numOf(w1) != null) return { text: String(numOf(w1)), kind: "number" };
    if (numOf(w2) != null && w1 && /(te|ten|tes|ter)$/.test(w1)) return { text: String(numOf(w2)), adj: w1.replace(/(en|er|es|e)$/, ""), kind: "number" };
    return null;
  }

  function findMentions(st, body, skipRanges) {
    const out = [];
    const ws = words(body);
    for (const t of ws) {
      if (skipRanges.some(([a, b]) => t.i >= a && t.i < b)) continue;
      if (lex.TOOLS.includes(t.lw)) continue;
      const eq = lex.EQUIPMENT.find((e) => e.keys.some((k) => t.lw === k || (k.length >= 4 && t.lw.endsWith(k))));
      if (eq) {
        const after = body.slice(t.i + t.w.length).match(/^\s*\(([^)]*)\)/);
        out.push({ kind: "equipment", canon: eq.name, word: t.w, note: after ? after[1].trim() : "", pos: t.i });
        continue;
      }
      const parts = t.lw.split("-");
      // „Selleriestange“ → „sellerie“, „Möhrenwürfel“ → „möhren“
      const variants = (p) => [p].concat(lex.PIECE.filter((x) => p.endsWith(x) && p.length - x.length >= 3).map((x) => p.slice(0, -x.length)));
      const hits = [];
      for (const z of st.model.ingredients) {
        let best = 0, modifier = false;
        for (const key of z._keys) for (const p of parts) {
          const vs = variants(p);
          if (!vs.some((v) => M.tokenMatchesKey(v, key))) continue;
          // enthaltener Schlüssel schlägt Kurzform: „Tomaten“ → passierte Tomaten, nicht Tomatenmark
          const score = (vs.some((v) => v.includes(key)) ? 100 : 0) + key.length;
          if (score <= best) continue;
          best = score;
          // Zutat nur als Bestimmungswort: „Salzwasser“ ist frisches Salz, nicht das Salz in der Soße
          modifier = p.includes(key) && !vs.some((v) => v.endsWith(key) || M.stem(v).endsWith(key) || key.endsWith(M.stem(v)));
        }
        if (best) hits.push({ z, best, modifier });
      }
      if (!hits.length) {
        const food = lex.FOODS.find((f) => !f.includes(" ") && (t.lw === f || M.stem(t.lw) === M.stem(f)));
        if (food) hits.push({ z: addMissing(st, cap(food)), best: food.length });
      }
      if (!hits.length) continue;
      // je Wortteil nur die Zutat mit dem längsten Schlüssel
      const chosen = hits.length > 1 && parts.length === 1 ? [hits.sort((a, b) => b.best - a.best)[0]] : hits;
      const productToken = chosen.length > 1 || PRODUCT_PIECES.some((p) => t.lw.endsWith(p) && t.lw !== p);
      const portion = portionBefore(body, t.i);
      const piece = ["flöckchen", "flocken"].find((p) => t.lw.endsWith(p) && t.lw !== p);
      for (const h of chosen) {
        let p = portion && !wholeUse(h.z, portion) ? Object.assign({}, portion) : null;
        // „Haferflocken“ ist die Zutat selbst, „Butterflöckchen“ ein Stück davon
        if (piece && !h.z.name.toLowerCase().endsWith(piece)) p ={ text: (p ? p.text + " " : "") + cap(piece), kind: "part" };
        else if (p && p.kind === "number") {
          const unitPiece = ["zehe", "zehen", "scheibe", "scheiben"].find((x) => t.lw.endsWith(x));
          p.text = p.text + (unitPiece ? " " + cap(unitPiece) : "") + (p.adj ? ", " + p.adj : "");
        }
        out.push({ kind: "ingredient", z: h.z, word: t.w, pos: t.i, portion: p, productToken, modifier: !!h.modifier && !productToken });
      }
    }
    return out;
  }

  /** „die 40 g Butter“ bei 40 g in der Liste, „1 Selleriestange“ bei 50 g Sellerie: die ganze Zutat, kein Anteil. */
  function wholeUse(z, p) {
    const q = z.qty;
    if (p.kind === "amount") return !!(q && z.unit && (lex.UNIT_MAP[z.unit.toLowerCase()] || z.unit) === p.unit && p.n >= q.min - 1e-9);
    if (p.kind !== "number") return false;
    if (z.unit && !/^(stück|zehen?|scheiben?|blatt|blätter|zweige?|dosen?|becher|gläser|glas|bund|pck\.)$/i.test(z.unit)) return true;
    const n = parseFloat(String(p.text).replace(",", "."));
    return !!(q && isFinite(n) && n >= q.max - 1e-9);
  }

  function addMissing(st, name) {
    const z = { id: M.newId(st.model, "z"), qty: null, unit: "", name, note: "", optional: false, missing: true, line: "" };
    z._keys = M.keysFor(name);
    st.model.ingredients.push(z);
    return z;
  }

  function extractDetail(body) {
    const found = [];
    const parens = [];
    { const re = /\([^)]*\)/g; let m; while ((m = re.exec(body))) parens.push([m.index, m.index + m[0].length]); }
    const inParens = (a) => parens.some(([x, y]) => a > x && a < y);
    const take = (re, fmt, allowInParens) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(body))) {
        const a = m.index, b = a + m[0].length;
        if ((allowInParens || !inParens(a)) && !found.some((f) => a < f.b && b > f.a)) found.push({ a, b, text: fmt ? fmt(m) : m[0] });
        if (!re.global) break;
      }
    };
    take(/\((\d{2,3})\s*(?:°\s*C?|Grad)\s*(Umluft|Heißluft)\)/gi, (m) => "(" + m[2] + " " + m[1] + " °C)", true);
    take(/\d+(?:[,.]\d+)?\s*(?:[-–]\s*\d+(?:[,.]\d+)?)?\s*(?:mm|cm)\b(?!\s*[×x])/gi);
    // „Bauchspeck-Würfel“ ist eine Zutat, keine Schnittform
    take(/(?<!-)\b(?:(?:sehr|ganz)\s+)?(?:(?:dünne|dünnen|dicke|dicken|feine|feinen|grobe|groben|kleine|kleinen|große|großen|gleichmäßige|mundgerechte)\s+)?(?:Scheiben|Ringe|Halbringe|Würfel|Streifen|Stifte|Spalten|Stücke|Röschen|wedges|slices|cubes|rings)\b/g);
    take(/\b(?:fein|grob|dünn|finely|thinly|coarsely)\b/gi);
    const LEVEL = "(?:mittlerer|kleiner|starker|schwacher|hoher|niedriger|mäßiger|großer)";
    take(new RegExp("Ober-\\s*\\/\\s*Unterhitze|\\bUmluft\\b|\\bHeißluft\\b|(?:bei|auf)\\s+" + LEVEL + "(?:\\s+bis\\s+" + LEVEL + ")?\\s+(?:Hitze|Stufe|Flamme)|(?:low|medium|high)\\s+heat", "gi"), (m) => m[0].replace(/^(Bei|Auf)\b/, (x) => x.toLowerCase()));
    take(/mit\s+(?:Alu)?folie(?:\s+(?:abgedeckt|zugedeckt))?|mit\s+(?:dem\s+)?(?:(?:halb|leicht)\s+)?(?:(?:geöffnetem|offenem|aufgelegtem|geschlossenem)\s+)?Deckel|ohne\s+(?:Alu)?folie|ohne\s+Deckel|\babgedeckt\b|\bzugedeckt\b|\buncovered\b|\bcovered\b/gi);
    take(/(?:leicht\s+)?überlappend|schuppenartig|an den (?:Wänden|Rändern)|rundherum|skin (?:up|down)/gi);
    found.sort((x, y) => x.a - y.a);
    let out = "";
    found.forEach((f, i) => {
      if (i === 0) out = f.text;
      else out += (/^\s*$/.test(body.slice(found[i - 1].b, f.a)) ? " " : ", ") + f.text;
    });
    return out.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  }

  /** Erste Zeitangabe im Text in Minuten; „1 Std. 30 Min.“ und „1 Stunde und 30 Minuten“ zählen zusammen. */
  function durationIn(text) {
    DUR_RE.lastIndex = 0;
    const m = DUR_RE.exec(text);
    if (!m) return null;
    const val = (s) => (M.parseQty(s.replace(/\s+/g, "")) || {}).min;
    const hours = /^(std|stunde|h|hour|hr)/i.test(m[3]);
    let a = val(m[1]), b = m[2] ? val(m[2]) : a;
    if (a == null || b == null) return null;
    if (/^(sek|sec)/i.test(m[3])) return { min: a / 60, max: b / 60 };
    if (hours) {
      a *= 60; b *= 60;
      // Minuten direkt dahinter gehören dazu, aber nicht zu einer Spanne („1-2 Std.“)
      const n = DUR_RE.exec(text);
      if (!m[2] && n && !n[2] && !/^(std|stunde|h|hour|hr)/i.test(n[3]) && /^\s*(?:und\s+|and\s+)?$/i.test(text.slice(m.index + m[0].length, n.index))) {
        const extra = val(n[1]);
        if (extra != null) { a += extra; b += extra; }
      }
    }
    return { min: a, max: b };
  }

  // ---- Handlung → Schritt -------------------------------------------------------------

  function equipNode(st, mention) {
    let g = st.model.equipment.find((x) => x.canon === mention.canon);
    if (!g) {
      g = { id: M.newId(st.model, "g"), name: cap(mention.word.replace(/^(den|die|das)\s+/i, "")), note: mention.note || "", canon: mention.canon };
      st.model.equipment.push(g);
    } else if (!g.note && mention.note) g.note = mention.note;
    return g;
  }

  /** true, wenn ref gleich target ist oder target in ref eingeflossen ist. */
  function reaches(model, ref, target, seen) {
    if (ref === target) return true;
    seen = seen || new Set();
    if (seen.has(ref)) return false;
    seen.add(ref);
    const s = model.steps.find((x) => x.id === ref);
    return !!s && s.inputs.some((x) => reaches(model, x.ref, target, seen));
  }

  // Verben, die etwas in eine bestehende Masse einarbeiten
  const INTO = new Set(["unterheben", "unterrühren", "unterziehen", "untermischen", "einrühren", "unterarbeiten", "unterkneten", "fold"]);
  const MASS_WORD = /(?<![-\wäöüß])(teig(?:e?s)?|masse|mischung|batter|dough|mixture)(?![-\wäöüß])/i;
  const verbClass = (s) => (lex.V[String(s.verb).toLowerCase().split(" ")[0]] || {}).cls;

  function reachesCombine(model, ref, seen) {
    seen = seen || new Set();
    if (seen.has(ref)) return false;
    seen.add(ref);
    const s = model.steps.find((x) => x.id === ref);
    return !!s && (verbClass(s) === "combine" || s.inputs.some((x) => reachesCombine(model, x.ref, seen)));
  }

  /** Zutaten und Schritte, aus denen ein Schritt entsteht. */
  function upstreamOf(model, s) {
    const out = new Set();
    const walk = (x) => {
      for (const inp of x.inputs) {
        if (out.has(inp.ref)) continue;
        out.add(inp.ref);
        const t = model.steps.find((y) => y.id === inp.ref);
        if (t) walk(t);
      }
    };
    walk(s);
    return out;
  }

  /** Strang beginnt bei einem Gerät (Form, Ofen) statt bei Zutaten. */
  function equipmentLed(model, s) {
    for (let x = s, guard = 0; x && guard < 50; guard++) {
      if (verbClass(x) === "equip") return true;
      const first = x.inputs[0];
      if (!first) return false;
      if (model.equipment.some((g) => g.id === first.ref)) return true;
      x = model.steps.find((y) => y.id === first.ref);
    }
    return false;
  }

  /** Hauptmasse für „unterheben“: offener, älterer Zutatenstrang mit den meisten Zutaten. */
  function mainMass(st, step, inputs, side) {
    const model = st.model;
    const sideUp = upstreamOf(model, side);
    const sideStart = Math.min(model.steps.indexOf(side), ...[...sideUp].map((id) => model.steps.findIndex((y) => y.id === id)).filter((i) => i >= 0));
    const count = (s) => [...upstreamOf(model, s)].filter((id) => model.ingredients.some((z) => z.id === id)).length;
    let best = null, bestN = 0;
    model.steps.forEach((s, i) => {
      if (s === step || i >= sideStart || st.consumed.has(s.id) || equipmentLed(model, s)) return;
      if (inputs.some((x) => reaches(model, x.ref, s.id))) return;
      const n = count(s);
      if (n && n >= bestN) { best = s; bestN = n; }
    });
    return best;
  }

  const SEASONING = /^(?:salz|pfeffer|salt|pepper|black pepper|schwarzer pfeffer)$/i;

  // Verben, die das Gargut aus seiner Flüssigkeit holen
  const TAKE_OUT = new Set(["herausnehmen", "herausheben", "abschöpfen", "abgießen", "abseihen"]);

  /** Erwähnung steht hinter „in der“, „im“, „mit etwas“ …: Garmedium, nicht Gargut. */
  const afterIn = (body, pos, withMit) =>
    new RegExp("\\b(?:in|im" + (withMit ? "|mit" : "") + ")\\s+(?:(?:der|dem|den|die|das|etwas|wenig|reichlich)\\s+)?(?:[a-zäöüß]+\\s+)?$", "i").test(body.slice(Math.max(0, pos - 40), pos));

  /** Alle genannten Zutaten sind nur das Garmedium („in der Margarine“, „in der Brühe“, „mit etwas Öl“). */
  function mediumOnly(mentions, body) {
    const ings = mentions.filter((m) => m.kind === "ingredient");
    return ings.length > 0 && ings.every((m) => afterIn(body, m.pos, true));
  }

  function currentDish(st, exclude) {
    if (st.prev && !st.consumed.has(st.prev.id) && st.prev !== exclude) return st.prev;
    for (let i = st.model.steps.length - 1; i >= 0; i--) {
      const s = st.model.steps[i];
      if (s !== exclude && !st.consumed.has(s.id)) return s;
    }
    return null;
  }

  function makeAction(st, info) {
    const model = st.model;
    const body = info.text.slice(info.offset);
    let verb = info.labelVerb
      ? { key: info.labelVerb, display: info.labelVerb, cls: lex.V[info.labelVerb].cls, k: -1 }
      : findVerb(body) || { key: "", display: "?", cls: "other", k: -1 };
    // „Stir in the garlic“, „fold in the flour“: etwas ins Gericht geben
    if (verb.en && new RegExp("^\\s*" + verb.key + "\\s+in\\b", "i").test(body)) verb = Object.assign({}, verb, { cls: "add" });
    const step = {
      id: M.newId(model, "s"), verb: verb.display, detail: "", inputs: [], dur: null, temp: "", passive: lex.PASSIVE.has(verb.key) || / lassen$/.test(verb.display),
      repeat: "", cue: info.cue || "", note: "", product: "", src: info.src || body.trim(), srcStep: st.n,
      srcRange: [info.absStart, info.absStart + (info.src || body).length]
    };

    step.dur = durationIn(body);
    // \b greift vor „ü“ nicht (kein Wortzeichen in JS-Regex ohne u-Flag)
    if (!step.dur && /(?:^|\s)(über Nacht|overnight)\b/i.test(body)) step.dur = { min: 480, max: 720, est: true };
    const tm = body.match(TEMP_RE);
    if (tm) step.temp = tm[1] + " °" + (tm[2] || (tm[3] ? tm[3][0] : "C")).toUpperCase();
    step.detail = extractDetail(body);

    // Wortbereiche des Verbs nicht als Zutat lesen
    const skip = [];
    if (!info.labelVerb) {
      const ws = words(body);
      for (const w of ws) if (verb.display.split(" ").includes(w.lw) && lex.V[w.lw] && w.w[0] === w.w[0].toLowerCase()) skip.push([w.i, w.i + w.w.length]);
      if (verb.spans) skip.push(...verb.spans);
    }
    const known = model.ingredients.length;
    const mentions = findMentions(st, body, skip).sort((a, b) => a.pos - b.pos);
    // „in den Backofen schieben und etwa 55 Minuten backen“: ein Backschritt, die Dauer gehört zum ersten
    const pv = st.prev;
    if (lex.OVEN.has(verb.key) && pv && pv.verb === step.verb && !pv.dur && pv.srcStep === st.n && !st.consumed.has(pv.id) && !mentions.some((x) => x.kind === "ingredient")) {
      pv.dur = step.dur; pv.temp = pv.temp || step.temp;
      pv.detail = [pv.detail, step.detail].filter(Boolean).join(", ");
      if (step.cue) pv.cue = step.cue;
      pv.src += " " + step.src; pv.srcRange[1] = step.srcRange[1];
      return;
    }
    // „Dazu nach Belieben Parmesan reichen“: nicht gelistete Zutat ist optional
    if (/\b(nach belieben|optional|wer mag)\b/i.test(body)) for (const z of model.ingredients.slice(known)) z.optional = true;

    const inputs = [];
    const addInput = (ref, portion) => {
      const ex = inputs.find((x) => x.ref === ref);
      if (ex) { if (portion && !ex.portion) ex.portion = portion; return; }
      inputs.push({ ref, portion: portion || "" });
    };
    const fullRaw = [];
    let ovenMention = false;
    const newContainer = /\b(in|auf)\s+(eine|einer|einen|einem|ein)\s+(?:[a-zäöüß]+\s+)?[\wäöüß-]*(schüssel|topf|pfanne|form|blech|bräter|glas|kasserolle)\b|\b(in|into)\s+an?\s+(?:\w+\s+)?(bowl|pan|pot|dish|skillet)\b/i.test(body);
    // nur Begleitzutaten: „mit 1 EL Öl und Salz mischen“, „abwechselnd mit der Milch unterrühren“
    const AMOUNT_GAP = "(?:(?:der|dem|den|etwas|\\d+(?:[,.]\\d+)?\\s+\\S+)\\s+)?(?:[a-zäöüß]+\\s+)?$";
    const alongOnly = mentions.length > 0 && mentions.every((x) => x.kind === "ingredient") &&
      new RegExp("\\bmit\\s+" + AMOUNT_GAP, "i").test(body.slice(Math.max(0, mentions[0].pos - 40), mentions[0].pos)) &&
      mentions.every((x, k) => !k || new RegExp("^[\\s,]*(?:und|sowie|and)?\\s*" + AMOUNT_GAP, "i").test(body.slice(mentions[k - 1].pos + mentions[k - 1].word.length, x.pos)));

    const media = [], mediumRefs = new Set(), filled = [];
    for (const men of mentions) {
      if (men.kind === "ingredient") {
        // Garflüssigkeit, aus der das Gargut schon herausgenommen ist: „die Brokkoliröschen in der Brühe kochen“
        const med = st.medium.get(men.z.id);
        const asMedium = verb.cls === "heat" && afterIn(body, men.pos);
        if (med) {
          if (!inputs.some((x) => x.ref === med)) { addInput(med, men.portion ? men.portion.text : cap(men.word)); mediumRefs.add(med); }
          if (asMedium) { st.medium.delete(men.z.id); media.push(men.z.id); }
          continue;
        }
        const h = st.holder.get(men.z.id);
        if (asMedium && h && !st.consumed.has(h) && !men.modifier) media.push(men.z.id);
      }
      if (men.kind === "equipment") {
        if (men.canon === "Ofen") ovenMention = true;
        const holder = st.holder.get("eq:" + men.canon);
        if (verb.cls === "equip") {
          if (holder && !st.consumed.has(holder)) addInput(holder);
          else { const g = equipNode(st, men); addInput(g.id); st.holder.set("eq:" + men.canon, step.id); }
        } else if (men.canon !== "Ofen") {
          if (holder && !st.consumed.has(holder)) addInput(holder);
          else filled.push(men.canon);
        }
        continue;
      }
      const z = men.z;
      const h = st.holder.get(z.id);
      const hUsable = h && !st.consumed.has(h);
      const portionText = men.portion ? men.portion.text : "";
      if (men.modifier) { addInput(z.id, portionText); continue; }
      // Salz und Pfeffer kommen immer wieder frisch dazu; eine neue Prise holt nicht das Gericht, in dem die erste steckt
      if (hUsable && SEASONING.test(z.name) && !men.productToken && (currentDish(st, step) || {}).id !== h) { addInput(z.id, portionText); continue; }
      if (hUsable && (!men.portion || men.productToken)) {
        const cur = currentDish(st, step);
        // „mit Salz abschmecken“ am Gericht, das schon Salz enthält: der Rest. „die Kartoffeln …“, „… in einen Topf geben“: das Gericht selbst
        const definite = /\b(?:der|die|das|den|dem|des|the)\s+(?:[a-zäöüß]+\s+)?$/i.test(body.slice(Math.max(0, men.pos - 25), men.pos));
        if (verb.cls === "add" && cur && cur.id === h && !men.productToken && !newContainer && !definite) {
          addInput(z.id, portionText || "Rest");
        } else {
          addInput(h, men.productToken ? portionText : "");
          const hs = model.steps.find((x) => x.id === h);
          const lw = men.word.toLowerCase();
          if (hs && !hs.product && lw !== z.name.toLowerCase() && (men.productToken || lw.includes("-"))) hs.product = cap(men.word);
        }
      } else {
        addInput(z.id, portionText);
        if (!men.portion || men.portion.kind === "rest") fullRaw.push(z.id);
      }
    }

    // „Gemüse darin andünsten“: alle offenen, geschnittenen Zutaten
    if (/(?:^|[^-\wäöüß])gemüse(?![-\wäöüß])/i.test(body) && !mentions.some((x) => x.kind === "ingredient" && /^gemüse$/i.test(x.word))) {
      for (const s of model.steps) if (!st.consumed.has(s.id) && verbClass(s) === "prep" && !equipmentLed(model, s)) addInput(s.id);
    }
    // „Form fetten“, „ausbuttern“ ohne genannte Zutat: das gelistete Fett, die Butter
    if (verb.cls === "equip" && !mentions.some((x) => x.kind === "ingredient")) {
      const z = model.ingredients.find((x) => x._keys.some((k) => k.length >= 4 && verb.key.includes(k)));
      if (z) addInput(z.id, "");
    }
    // „in den heißen Backofen stellen“: das ist Backen
    if (ovenMention && /^(stellen|schieben|geben|setzen)$/.test(verb.key) && /\bin\s+den\s+(?:[a-zäöüß]+\s+)?(?:back)?ofen\b/i.test(body)) {
      verb = { key: "backen", display: "backen", cls: "heat", k: -1 };
      step.verb = "backen"; step.passive = true;
    }
    if (verb.key === "vorheizen" || verb.key === "preheat") {
      if (!mentions.some((x) => x.kind === "equipment" && x.canon === "Ofen")) {
        const g = equipNode(st, { canon: "Ofen", word: "Ofen", note: "" });
        addInput(g.id); st.holder.set("eq:Ofen", step.id);
      }
      step.passive = true;
    }

    // Fortsetzung des aktuellen Gerichts
    const isStepRef = (ref) => model.steps.some((x) => x.id === ref);
    const rawIngredients = inputs.filter((x) => model.ingredients.some((z) => z.id === x.ref));
    // auch im Verb: „darübergießen“, „hineinschlagen“
    const anaphor = /\b(darin|darauf|dazu|hinein|daran|darüber|obenauf|in it|on top|over it)\b/i.test(body) || /^(darüber|darauf|hinein|darunter)/.test(verb.key);
    const cur = currentDish(st, step);
    const prevOpen = st.prev && !st.consumed.has(st.prev.id) ? st.prev : null;
    const included = (s) => s && inputs.some((x) => x.ref === s.id);
    let chainTo = null;
    if (anaphor && prevOpen && !included(prevOpen)) chainTo = prevOpen;                       // „darin“, „darauf“
    else if (!inputs.length) chainTo = cur;                                                   // nur Verb: am Gericht weiter
    else if (verb.cls === "add" && !newContainer && !included(cur)) chainTo = cur;            // etwas zum Gericht geben
    else if (info.join === "und" && verb.cls !== "equip" && !rawIngredients.length && !inputs.some((x) => isStepRef(x.ref)) && prevOpen && !included(prevOpen)) chainTo = prevOpen; // „… abgießen und mit dem Öl schwenken“
    else if (info.join === "und" && verb.cls === "combine" && prevOpen && !included(prevOpen)) chainTo = prevOpen; // „… in eine Schüssel geben und mit dem Öl vermischen“
    else if (info.join === "und" && verb.cls === "heat" && prevOpen && !included(prevOpen) && mediumOnly(mentions, body)) chainTo = prevOpen; // „Zwiebel würfeln und in der Butter braten“
    else if (alongOnly && verb.cls !== "equip" && info.join !== "new" && prevOpen && !included(prevOpen)) chainTo = prevOpen; // „Kartoffeln halbieren, mit Öl und Salz mischen“
    if (chainTo) inputs.unshift({ ref: chainTo.id, portion: "" });
    // „Beides in eine Auflaufform geben“: auch der vorige offene Strang
    if (chainTo && /\bbeides?\b/i.test(body)) {
      const other = model.steps.slice().reverse().find((s) => s !== chainTo && !st.consumed.has(s.id) && !included(s) && !equipmentLed(model, s));
      if (other) inputs.push({ ref: other.id, portion: "" });
    }
    // „Mehl mit Backpulver mischen und unterheben“: der eben angerührte Nebenstrang kommt in die Hauptmasse,
    // auch „… und abwechselnd mit der Milch unterrühren“ (nur Begleitzutaten mit „mit“)
    if (INTO.has(verb.key) && (!mentions.length || alongOnly) && chainTo && chainTo.srcStep === st.n) {
      const main = mainMass(st, step, inputs, chainTo);
      if (main) inputs.unshift({ ref: main.id, portion: "" });
    }
    // „den Teig“, „the batter“: die zuletzt angerührte Masse, wenn keiner der Eingänge sie enthält;
    // „auf dem hellen Teig verteilen“: die Masse, die schon in der Form liegt
    const onMass = /\b(?:auf|über)\s+(?:den|dem|die|das)\s+(?:[a-zäöüß]+\s+)?(?:teig|masse)\b/i.test(body);
    if (MASS_WORD.test(body) && (onMass || !inputs.some((x) => reachesCombine(model, x.ref)))) {
      const mix = model.steps.slice().reverse().find((s) => s !== step && !st.consumed.has(s.id) && (onMass ? reachesCombine(model, s.id) : verbClass(s) === "combine") && !inputs.some((x) => reaches(model, x.ref, s.id)));
      if (mix) inputs.push({ ref: mix.id, portion: "" });
    }
    // Anrichten führt alle offenen Stränge zusammen („Nudeln mit der Bolognese servieren“)
    if (verb.cls === "finish") {
      for (const s of model.steps) {
        const cls = (lex.V[String(s.verb).split(" ")[0]] || {}).cls;
        if (!st.consumed.has(s.id) && !included(s) && cls !== "equip") inputs.push({ ref: s.id, portion: "" });
      }
    }

    // Ofen anschließen: Backverben, Erwähnung des Ofens, oder abdecken mit Zeit in einem Backsatz
    const coverWithTime = (verb.key === "abdecken" || verb.key === "zudecken") && step.dur && info.ovenSentence;
    if (coverWithTime) {
      step.verb = "backen";
      if (/abgedeckt|zugedeckt/.test(step.detail)) { /* steht schon da */ }
      else if (/mit\s+(?:Alu)?folie|mit\s+(?:dem\s+)?Deckel/i.test(step.detail)) step.detail = step.detail.replace(/(mit\s+(?:Alu)?folie|mit\s+(?:dem\s+)?Deckel)/i, "$1 abgedeckt");
      else step.detail = step.detail ? "abgedeckt, " + step.detail : "abgedeckt";
      step.passive = true;
    }
    if (lex.OVEN.has(verb.key) || coverWithTime || (ovenMention && verb.cls !== "equip")) {
      const oh = st.holder.get("eq:Ofen");
      const ohStep = oh && oh !== step.id ? model.steps.find((x) => x.id === oh) : null;
      if (ohStep && !inputs.some((x) => x.ref === oh)) {
        const ohIsPrep = ((lex.V[String(ohStep.verb).split(" ")[0]] || {}).cls) === "equip";
        if (ohIsPrep && !st.consumed.has(oh)) inputs.push({ ref: oh, portion: "" });
        // Im Ofen steckt schon ein anderes Gericht: nicht damit verschmelzen, nur den vorgeheizten Ofen mitbenutzen
        else if (!ohIsPrep && st.ovenPrep && !inputs.some((x) => reaches(model, x.ref, oh)) && !inputs.some((x) => x.ref === st.ovenPrep)) inputs.push({ ref: st.ovenPrep, portion: "" });
      }
    }
    if (inputs.some((x) => { const g = model.equipment.find((e) => e.id === x.ref); return g && g.canon === "Ofen"; })) st.ovenPrep = step.id;

    step.inputs = inputs;
    model.steps.push(step);

    // Verbrauch & Halter weiterreichen
    // Gargut herausnehmen oder umfüllen: die Garflüssigkeit bleibt im Topf zurück
    const takeOut = TAKE_OUT.has(verb.key) || newContainer;
    for (const inp of inputs) {
      if (!isStepRef(inp.ref) || inp.ref === step.id) continue;
      // nach „herausnehmen“ kommt die Brühe aus diesem Schritt (erst herausnehmen, dann weiterverwenden)
      if (takeOut) for (const [z, s] of st.mediumAt) if (s === inp.ref) { st.medium.set(z, TAKE_OUT.has(verb.key) ? step.id : s); st.mediumAt.delete(z); }
      if (mediumRefs.has(inp.ref)) continue;
      st.consumed.add(inp.ref);
      for (const [k, v] of st.holder) if (v === inp.ref) st.holder.set(k, step.id);
    }
    for (const id of fullRaw) st.holder.set(id, step.id);
    for (const id of media) st.mediumAt.set(id, step.id);
    // „Beides in eine Auflaufform geben“: später meint „in die Auflaufform“ diesen Inhalt
    if (newContainer) for (const c of filled) st.holder.set("eq:" + c, step.id);

    for (const [field, text] of st.pendingNotes) appendField(step, field, text);
    st.pendingNotes = [];
    st.prev = step;
  }

  FK.parse = parse;
  FK.parser = { parse, parseIngredientLine, findVerb, extractDetail, durationIn };
})(window.FK = window.FK || {});
