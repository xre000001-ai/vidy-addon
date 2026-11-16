'use strict';
// v1.34.262 — MultiMovies "Orion/Vidrift" provider parsing (pure, no network).
//
// The MM server list has a second stream server, Vidrift, whose embed page embeds
// a plain JSON `orionStreams` array: one HLS entry per audio language
// (measured 16-11-2026, tt22084616 -> tmdb 969681: 8 languages x [480,720,1080]).
// Segments live on sacdn.hakunaymatata.com and answer 206. The whole chain is
// public (no resolver API, no proxy pool), and the master playlist is
// referer-gated (403 without one), so cards must carry the vidrift Referer.

// Pull the `"orionStreams":[...]` array out of an embed page without a JSON
// parser pass over the whole document (the page also contains other arrays).
function orionStreams(html) {
  const s = String(html || '');
  const i = s.indexOf('"orionStreams":');
  if (i < 0) return [];
  const j = s.indexOf('[', i);
  if (j < 0) return [];
  let depth = 0, end = -1;
  for (let k = j; k < s.length; k++) {
    const c = s[k];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) return [];
  try { const a = JSON.parse(s.slice(j, end)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

// One card per (language, top height >= minH). "Orion · Original" is the English
// track; provider names are already language-labelled on this server.
function cardsFromStreams(list, origin, minH) {
  const base = String(origin || '').replace(/\/+$/, '');
  const out = [];
  for (const st of (Array.isArray(list) ? list : []).slice(0, 14)) {
    const u = String((st && st.url) || '');
    if (!/^\/api\//.test(u)) continue;                     // only the embed's own proxy paths
    const rungs = (st && Array.isArray(st.rungs)) ? st.rungs : [];
    const hs = rungs.map(r => parseInt(r && r.height, 10) || 0).filter(h => h >= (minH || 720));
    if (!hs.length) continue;
    const nm = String((st && st.name) || '');
    const lang = (nm.split(/[·|]/).pop() || '').trim().replace(/^Original$/i, 'English');
    out.push({ h: Math.max.apply(null, hs), url: base + u, lang: lang, hs });
  }
  const seen = new Set();
  return out.filter(v => { const k = v.h + '|' + v.lang; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { orionStreams, cardsFromStreams };
