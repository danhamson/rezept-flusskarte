/* Flusskarte – Wortschatz für den lokalen Rezept-Parser (Deutsch, etwas Englisch).
 * Verbklassen steuern, wie eine Handlung mit dem bisherigen Fluss verbunden wird:
 *   prep    – bearbeitet eine rohe Zutat für sich (schälen, hacken)
 *   combine – vereint die genannten Dinge (verrühren, schichten)
 *   add     – gibt etwas zum aktuellen Gericht (verteilen, abschließen)
 *   heat    – gart das aktuelle Gericht (backen, braten)
 *   rest    – Wartezeit ohne Handgriffe (ruhen lassen, abkühlen)
 *   equip   – bereitet ein Gerät vor (vorheizen, ausstreichen)
 *   finish  – Abschluss am fertigen Gericht (servieren, anrichten)
 */
(function (FK) {
  "use strict";

  const V = {};
  function def(cls, list, extra) {
    for (const w of list.split(/\s*,\s*/)) if (w) V[w] = Object.assign({ cls }, extra || {});
  }

  def("prep", "schälen,abschälen,schneiden,kleinschneiden,hacken,würfeln,hobeln,reiben,raspeln,pressen,zerdrücken,zerkleinern,halbieren,vierteln,achteln,putzen,waschen,abspülen,abtropfen,entkernen,entsteinen,zupfen,filetieren,parieren,plattieren,mahlen,zerstoßen,mörsern,sieben,abwiegen,trocknen,abtupfen,häuten,teilen,stifteln,entgräten,abzupfen,klopfen,wässern,abbrausen,aufschneiden,blättrig schneiden");
  def("combine", "verrühren,rühren,vermischen,mischen,vermengen,verquirlen,verkneten,kneten,mixen,pürieren,aufschlagen,schlagen,verschlagen,emulgieren,zusammenrühren,glattrühren,verbinden,schichten,einschichten,aufschichten");
  def("add", "zugeben,hinzufügen,dazugeben,hinzugeben,unterrühren,unterheben,einrühren,unterziehen,einstreuen,bestreuen,streuen,verteilen,belegen,beträufeln,übergießen,aufgießen,angießen,ablöschen,gießen,würzen,abschmecken,salzen,pfeffern,abschließen,füllen,einfüllen,bestreichen,glasieren,untermischen,auffüllen,einlegen,legen,geben,setzen,abreiben,einreiben");
  def("heat", "backen,überbacken,gratinieren,braten,anbraten,rösten,anrösten,kochen,aufkochen,köcheln,simmern,garen,dünsten,andünsten,schmoren,frittieren,grillen,dämpfen,pochieren,erhitzen,erwärmen,zerlassen,schmelzen,karamellisieren,reduzieren,einkochen,sautieren,ausbacken,toasten,blanchieren,abdecken,zudecken");
  def("rest", "ruhen,ziehen,quellen,abkühlen,auskühlen,kühlen,gehen,marinieren,einweichen,durchziehen,stehen,auftauen,gefrieren,abtropfen lassen,kaltstellen,kalt stellen");
  def("equip", "vorheizen,einfetten,fetten,ausfetten,ausstreichen,buttern,ausbuttern,auslegen,bemehlen,ausreiben");
  def("finish", "servieren,anrichten,portionieren,tranchieren,garnieren,auftragen");
  def("prep", "abgießen,abseihen,abschrecken,auspressen,ausdrücken,zerbröseln,ausrollen,formen,abziehen,einritzen,einschneiden,zerteilen,zerpflücken,entrinden,auslösen,ausstechen,aushöhlen,durchpressen,passieren,abschöpfen,entfernen,zerkrümeln");
  def("combine", "schwenken,umrühren,durchrühren,unterarbeiten,aufschäumen,montieren,vermahlen");
  def("add", "dazufügen,hinzugießen");
  def("heat", "zubereiten,einköcheln");
  def("add", "bestäuben,aufstreichen,beträufeln,überstreuen,auflegen,darübergeben,dazugießen,einstreuen,nachwürzen,beifügen");
  def("heat", "wenden,anschwitzen,aufbacken,backen lassen,schmelzen lassen,erhitzen lassen,auslassen,einreduzieren,abflämmen,bräunen,rösten lassen");

  // Englisch; en: Verb steht vorn
  const EN = { en: true };
  def("prep", "peel,slice,chop,dice,mince,grate,cut,crush,halve,quarter,trim,wash,rinse,drain,core,pit,zest,shred,julienne,puree", EN);
  def("combine", "mix,stir,whisk,combine,blend,beat,knead,fold,layer,assemble", EN);
  def("add", "add,toss,sprinkle,spread,pour,season,top,drizzle,coat,brush,fill,place,put,set,arrange,transfer,stuff", EN);
  def("finish", "remove,flip,turn", EN);
  def("heat", "bake,roast,fry,saute,sauté,boil,simmer,cook,heat,melt,grill,broil,steam,braise,sear,brown,reduce,cover", EN);
  def("rest", "rest,cool,chill,refrigerate,marinate,soak,let", EN);
  def("equip", "preheat,grease", EN);
  def("finish", "serve,garnish,plate", EN);

  // Gebeugte Formen (du/er): „schneidest du“, „man gibt“, „würzt“ → Infinitiv.
  // Trennbare Verben stehen als Grundform im Satz, die Partikel am Satzende: „dünstest … an“ → andünsten.
  const PARTICLES = ["zusammen", "darüber", "hinein", "heraus", "zurück", "hinzu", "durch", "unter", "klein", "glatt", "dazu", "über", "nach", "kalt", "weg", "auf", "aus", "bei", "ein", "mit", "vor", "ab", "an", "um", "zu"];
  const STRONG = {
    geben: ["gibst", "gibt"], nehmen: ["nimmst", "nimmt"], waschen: ["wäschst", "wäscht"], braten: ["brätst", "brät"],
    backen: ["bäckst", "bäckt", "backst", "backt"], schlagen: ["schlägst", "schlägt"], schmelzen: ["schmilzt"],
    stechen: ["stichst", "sticht"], tragen: ["trägst", "trägt"], halten: ["hältst", "hält"]
  };
  // „lässt … köcheln“ trägt das Verb im Infinitiv; „geht“, „steht“ sind zu mehrdeutig
  const NO_FINITE = new Set(["lassen", "gehen", "stehen"]);
  function conjugate(inf) {
    if (STRONG[inf]) return STRONG[inf];
    const stem = /e[lr]n$/.test(inf) ? inf.slice(0, -1) : /en$/.test(inf) ? inf.slice(0, -2) : "";
    if (stem.length < 2) return [];
    let du, er;
    if (/[dt]$|[^aeiouäöülrhmn][mn]$/.test(stem)) { du = stem + "est"; er = stem + "et"; }
    else if (/[sßzx]$/.test(stem)) { du = stem + "t"; er = du; }
    else { du = stem + "st"; er = stem + "t"; }
    return [du, er];
  }
  const FINITE = {};
  for (const inf of Object.keys(V)) {
    if (V[inf].en || inf.includes(" ")) continue;
    const add = (form, particle) => (FINITE[form] = FINITE[form] || []).push({ inf, particle });
    if (!NO_FINITE.has(inf)) for (const f of conjugate(inf)) add(f, "");
    const p = PARTICLES.find((x) => inf.startsWith(x) && inf.length - x.length >= 5);
    if (p && !NO_FINITE.has(inf.slice(p.length))) for (const f of conjugate(inf.slice(p.length))) add(f, p);
  }

  // Wartezeiten: Hände frei
  const PASSIVE = new Set("vorheizen,backen,überbacken,gratinieren,schmoren,köcheln,einköcheln,simmern,garen,dämpfen,ruhen,ziehen,quellen,abkühlen,auskühlen,kühlen,gehen,marinieren,einweichen,durchziehen,stehen,auftauen,gefrieren,kaltstellen,kalt stellen,abdecken,zudecken,preheat,bake,roast,braise,simmer,rest,cool,chill,refrigerate,marinate,soak".split(","));
  // Verben, die den Ofen brauchen
  const OVEN = new Set("backen,überbacken,gratinieren,ausbacken,bake,roast,broil".split(","));
  // Verben, die mit "lassen" zu einer Phrase werden
  const LASSEN = new Set("ruhen,ziehen,quellen,abkühlen,auskühlen,gehen,durchziehen,stehen,abtropfen,köcheln,einköcheln,simmern,einweichen,auftauen".split(","));

  // Partizipien für Zwischenprodukt-Namen
  const PARTICIPLE = {
    schälen: "geschält", schneiden: "geschnitten", hacken: "gehackt", würfeln: "gewürfelt", hobeln: "gehobelt",
    reiben: "gerieben", raspeln: "geraspelt", pressen: "gepresst", halbieren: "halbiert", putzen: "geputzt",
    waschen: "gewaschen", verrühren: "verrührt", vermischen: "vermischt", mischen: "gemischt", vermengen: "vermengt",
    verquirlen: "verquirlt", kneten: "geknetet", pürieren: "püriert", schichten: "geschichtet", ausstreichen: "ausgestrichen",
    abreiben: "abgerieben", einfetten: "eingefettet", vorheizen: "vorgeheizt", backen: "gebacken", braten: "gebraten",
    anbraten: "angebraten", kochen: "gekocht", dünsten: "gedünstet", andünsten: "angedünstet", rösten: "geröstet",
    verteilen: "verteilt", bestreuen: "bestreut", abschließen: "abgeschlossen", würzen: "gewürzt", ruhen: "geruht",
    abkühlen: "abgekühlt", marinieren: "mariniert", zerlassen: "zerlassen", schmelzen: "geschmolzen", schlagen: "geschlagen",
    aufschlagen: "aufgeschlagen", abdecken: "abgedeckt", ausbuttern: "ausgebuttert", auslegen: "ausgelegt",
    erhitzen: "erhitzt", abgießen: "abgegossen", schwenken: "geschwenkt", unterheben: "untergehoben", unterrühren: "untergerührt",
    servieren: "serviert", anrichten: "angerichtet", aufkochen: "aufgekocht", köcheln: "geköchelt", schmoren: "geschmort",
    garen: "gegart", dämpfen: "gedämpft", reduzieren: "reduziert", glasieren: "glasiert", füllen: "gefüllt", bestreichen: "bestrichen",
    zugeben: "zugegeben", hinzufügen: "hinzugefügt", einrühren: "eingerührt", kühlen: "gekühlt", überbacken: "überbacken",
    gratinieren: "gratiniert", frittieren: "frittiert", grillen: "gegrillt", wenden: "gewendet", rühren: "gerührt",
    geben: "gegeben", dazugeben: "dazugegeben", hinzugeben: "hinzugegeben", dazufügen: "dazugefügt", hinzugießen: "hinzugegossen",
    entfernen: "entfernt", abwiegen: "abgewogen", zerkrümeln: "zerkrümelt", ablöschen: "abgelöscht", umrühren: "umgerührt",
    abschmecken: "abgeschmeckt", zubereiten: "zubereitet", einköcheln: "eingeköchelt"
  };

  // Geräte. node: wird zur eigenen Zeile, wenn es vorbereitet werden muss
  const EQUIPMENT = [
    { name: "Ofen", keys: ["backofen", "ofen", "oven"] },
    { name: "Auflaufform", keys: ["auflaufform", "gratinform", "backform", "springform", "kastenform", "tarteform", "form", "baking dish", "dish", "pan"] },
    { name: "Backblech", keys: ["backblech", "blech", "baking sheet"] },
    { name: "Pfanne", keys: ["pfanne", "skillet"] },
    { name: "Topf", keys: ["topf", "bräter", "pot"] },
    { name: "Schüssel", keys: ["schüssel", "bowl"] }
  ];
  // Werkzeuge/Verbrauchsmaterial: nur als Detail, nie als Zutat
  const TOOLS = ["alufolie", "folie", "backpapier", "deckel", "messer", "hobel", "reibe", "schneebesen", "spatel", "foil", "lid", "knife"];

  const UNITS = [
    ["kg"], ["g", "gr", "gramm"], ["mg"], ["l", "liter"], ["ml"], ["cl"], ["dl"],
    ["EL", "el", "esslöffel", "essl."], ["TL", "tl", "teelöffel", "teel."], ["Msp.", "msp", "messerspitze"],
    ["Prise", "prise", "prisen"], ["Bund", "bund"], ["Zehe", "zehe", "zehen"], ["Stück", "stück", "stk", "stk.", "st."],
    ["Dose", "dose", "dosen"], ["Pck.", "pck", "pck.", "päckchen", "packung", "pkg"], ["Becher", "becher"], ["Tasse", "tasse", "tassen"],
    ["Glas", "glas", "gläser"], ["Scheibe", "scheibe", "scheiben"], ["Zweig", "zweig", "zweige"], ["Handvoll", "handvoll"],
    ["Blatt", "blatt", "blätter"], ["Würfel", "würfel"],
    ["cup", "cup", "cups", "c."], ["Tbs.", "tbs", "tbs.", "tbsp", "tbsp.", "tablespoon", "tablespoons"],
    ["tsp.", "tsp", "tsp.", "teaspoon", "teaspoons"], ["oz.", "oz", "oz.", "ounce", "ounces"], ["lb.", "lb", "lb.", "lbs", "lbs.", "pound", "pounds"],
    ["clove", "clove", "cloves"], ["can", "can", "cans"], ["pinch", "pinch"], ["stick", "stick", "sticks"]
  ];
  const UNIT_MAP = {};
  for (const [canon, ...alts] of UNITS) { UNIT_MAP[canon.toLowerCase()] = canon; for (const a of alts) UNIT_MAP[a.toLowerCase()] = canon; }

  // Adjektive, die nicht zum Kern einer Zutat gehören
  const ADJ = new Set(("frisch,frischer,frische,frisches,gemahlen,gemahlener,gemahlene,gemahlenes,getrocknet,getrocknete,getrockneter,fein,feine,grob,grobe,gehackt,gehackte,gehackter,gerieben,geriebener,geriebene,geschält,geschälte,vorwiegend,festkochend,festkochende,mehligkochend,weich,weiche,kalt,kalte,kaltes,warm,warme,groß,große,großer,klein,kleine,kleiner,mittelgroß,mittelgroße,schwarz,schwarzer,weißer,bunter,bunt,gesalzen,gesalzene,ungesalzen,ungesalzene,zimmerwarm,zimmerwarme,flüssig,flüssige,gemischt,gemischtes,gemischte,passiert,passierte,optional,ca.,etwa,fresh,ground,dried,large,medium,small,chopped,minced,grated,fine,finely").split(","));

  // Stückwörter, die an Zutaten hängen (Zwiebel-ringe, Butter-flöckchen)
  const PIECE = ["flöckchen", "flocken", "ringe", "ringen", "scheiben", "würfel", "würfeln", "streifen", "stücke", "stücken", "zehen", "zehe", "blätter", "blättchen", "spalten", "stifte", "hälften", "stange", "stangen", "mischung", "masse", "soße", "sauce", "creme", "teig"];

  // Gleichbedeutende Namen: „Karotte“ im Text findet „Möhre“ in der Zutatenliste
  const SYNONYMS = [["möhre", "karotte", "mohrrübe"], ["frühlingszwiebel", "lauchzwiebel"], ["kartoffel", "erdapfel"]];

  // Mengenwörter vor einer Zutat in Schritten
  const PORTION_WORDS = [
    [/^(den|dem|der|die|das)?\s*(restlichen|restliche|restlicher|übrigen|übrige|rest)\b/i, "Rest", "rest"],
    [/^(einen|ein)\s+teil\b/i, "ein Teil", "part"],
    [/^(die|eine)\s+hälfte\b/i, "½", "part"],
    [/^(ein|einem)\s+drittel\b/i, "⅓", "part"],
    [/^(etwas|wenig|ein wenig|ein paar|einige|reichlich)\b/i, null, "part"],
    [/^(the\s+)?(remaining|rest of the)\b/i, "rest", "rest"],
    [/^(some|a little|a bit of|half of the|half)\b/i, null, "part"]
  ];

  // Häufige Lebensmittel, um in Schritten genannte, aber nicht gelistete Zutaten zu finden
  const FOODS = ("butter,öl,olivenöl,mehl,zucker,salz,pfeffer,ei,eier,eigelb,eiweiß,milch,sahne,schmand,crème fraîche,creme fraiche,quark,joghurt,käse,parmesan,mozzarella,gouda,emmentaler,zwiebel,knoblauch,petersilie,schnittlauch,basilikum,thymian,rosmarin,oregano,muskat,paprika,tomate,tomaten,kartoffel,karotte,möhre,lauch,sellerie,zitrone,limette,essig,senf,honig,brühe,wein,speck,schinken,hackfleisch,brot,semmelbrösel,paniermehl,reis,nudeln,backpulver,hefe,vanille,zimt").split(",");

  // Schätzwerte (Minuten) für Schritte ohne Zeitangabe
  const ESTIMATE = {
    verb: { schälen: 5, hobeln: 4, schneiden: 3, hacken: 2, würfeln: 4, reiben: 3, schichten: 6, einschichten: 6, verrühren: 2, vorheizen: 15, ausstreichen: 1, abreiben: 1, verteilen: 1, abschließen: 1, servieren: 1, anrichten: 2, kneten: 5, preheat: 15, erhitzen: 2, entfernen: 1, waschen: 1, abwiegen: 1, zerkrümeln: 2 },
    cls: { prep: 3, combine: 2, add: 1, heat: 10, rest: 10, equip: 1, finish: 2, other: 2 }
  };

  FK.lex = { V, FINITE, PARTICLES, PASSIVE, OVEN, LASSEN, PARTICIPLE, EQUIPMENT, TOOLS, UNIT_MAP, ADJ, PIECE, SYNONYMS, PORTION_WORDS, FOODS, ESTIMATE };
})(window.FK = window.FK || {});
