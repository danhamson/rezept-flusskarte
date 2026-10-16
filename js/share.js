/* Flusskarte – Rezept als Code: komprimiertes JSON in einer Zeile zum Kopieren und Einfügen.
 * FK1.<base64url>  deflate-raw-komprimiert (Standard)
 * FK0.<base64url>  unkomprimiert (Browser ohne CompressionStream)
 * Ein Link trägt den Code im Fragment: …/#fk=FK1.…  (das Fragment geht nie an den Server).
 */
(function (FK) {
  "use strict";
  const CODE_RE = /FK[01]\.[A-Za-z0-9_-]{8,}/;

  /** Leere Felder weglassen; normalize() setzt sie beim Laden wieder ein. */
  function prune(v) {
    if (Array.isArray(v)) return v.map(prune);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (x === "" || x === null || x === undefined || x === false || (Array.isArray(x) && !x.length)) continue;
        o[k] = prune(x);
      }
      return o;
    }
    return v;
  }

  function compact(m, withSource) {
    const o = JSON.parse(JSON.stringify(m));
    o.format = "flusskarte/1";
    delete o.lint;
    if (!withSource) delete o.source;
    for (const s of o.steps || []) { delete s.srcRange; delete s.srcStep; }
    for (const z of o.ingredients || []) delete z.line;
    return prune(o);
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  function b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(str) {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  async function encode(m, opts) {
    const json = enc.encode(JSON.stringify(compact(m, !opts || opts.withSource !== false)));
    if (canZip) {
      try { return "FK1." + b64url(await pipe(json, new CompressionStream("deflate-raw"))); } catch (e) { /* Rückfall unten */ }
    }
    return "FK0." + b64url(json);
  }

  const BROKEN = "Der Code ist beschädigt oder unvollständig.";
  async function decodeOne(code) {
    let bytes;
    try { bytes = unb64url(code.slice(4)); } catch (e) { throw new Error(BROKEN); }
    if (code[2] === "1") {
      if (!canZip) throw new Error("Dieser Browser kann komprimierte Codes nicht entpacken. Bitte einen aktuellen Browser verwenden.");
      try { bytes = await pipe(bytes, new DecompressionStream("deflate-raw")); } catch (e) { throw new Error(BROKEN); }
    }
    let raw;
    try { raw = JSON.parse(dec.decode(bytes)); } catch (e) { throw new Error(BROKEN); }
    if (!raw || typeof raw !== "object" || !(Array.isArray(raw.steps) || Array.isArray(raw.ingredients))) throw new Error("Der Code enthält kein Rezept.");
    return raw;
  }

  /** Code (oder Text/Link mit Code) → Rohobjekt; wirft Error mit verständlicher Meldung. */
  async function decode(text) {
    const list = candidates(text);
    if (!list.length) throw new Error("Kein Rezept-Code gefunden. Ein Code beginnt mit „FK1.“.");
    let err = null;
    for (const code of list) {
      try { return await decodeOne(code); } catch (e) { err = err || e; }
    }
    throw err;
  }

  /** Mögliche Codes im Text, längster zuerst: Hat ein Messenger den Code auf mehrere Zeilen
   *  umbrochen, werden Folgezeilen aus reinen Code-Zeichen angehängt. Was davon passt, zeigt das Entpacken. */
  function candidates(text) {
    const s = String(text || "");
    const m = s.match(CODE_RE);
    if (!m) return [];
    const lines = s.slice(m.index + m[0].length).split(/\r?\n/);
    const out = [m[0]];
    if (!lines[0].trim()) {
      let joined = m[0];
      for (const line of lines.slice(1)) {
        const t = line.trim();
        if (!/^[A-Za-z0-9_-]+$/.test(t)) break;
        joined += t;
        out.unshift(joined);
      }
    }
    return out;
  }

  function find(text) {
    const list = candidates(text);
    return list.length ? list[0] : null;
  }

  /** true, wenn der Text nur aus einem Code oder einem Link mit Code besteht. */
  function isCodeOnly(text) {
    const s = String(text || "").replace(/\s+/g, "");
    return /^(?:\S*[#&?]fk=)?FK[01]\.[A-Za-z0-9_-]{8,}$/.test(s);
  }

  function fromHash(hash) {
    const m = String(hash || "").match(/[#&]fk=(FK[01]\.[A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /** Link zur App mit Code; null, wenn die Seite keine teilbare Adresse hat (Datei, Artefakt). */
  function linkFor(code) {
    if (!/^https?:$/.test(location.protocol) || (window.claude && window.claude.use)) return null;
    return location.origin + location.pathname + "#fk=" + code;
  }

  FK.share = { encode, decode, find, isCodeOnly, fromHash, linkFor, compact };
})(window.FK = window.FK || {});
