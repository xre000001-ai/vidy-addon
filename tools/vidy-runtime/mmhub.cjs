'use strict';
// v1.34.260 — Multimovies "download page" parse helpers (pure, no network).
//
// Why this exists: Multimovies' HLS index (Watchout2025/hls) and the vidbolt/movy
// resolve chain only ever hand out the 1080p ladder for some titles, while the
// site itself publishes a 4K package on its own download page:
//   /movie/<slug>-<titleId>  ->  /download/<slug>-<titleId>
//   <div class="dl-package-card"> "4K UHD 2160p" "81.9 GB" + HubCloud drive mirrors
// These helpers keep that parsing testable without booting server.js.

const DRIVE_RE = /https?:\/\/hubcloud\.[a-z.]+\/drive\/([A-Za-z0-9]{6,40})/gi;

// Alpha-numeric fold: drops parentheticals ("(Now in Hindi)"), quality/audio
// tokens and punctuation so "Spider-Man: Brand New Day" == "spiderman brand new day".
function norm(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:480p|720p|1080p|2160p|4k|uhd|hdrip|web[ .-]?dl|bluray|x264|x265|hevc|hindi|dubbed|dual audio|esub|full movie)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Never attach another film's 4K file to this title.
//  - year must be within 1 when both sides carry one
//  - every meaningful wanted token must appear as a whole token in the candidate
//  - candidate may not carry more than 3 extra tokens ("... Part Two Extras" etc.)
function titleMatch(want, cand, wantYear, candYear) {
  const A = norm(want), C = norm(cand);
  if (!A || !C) return false;
  const wy = parseInt(wantYear, 10) || 0, cy = parseInt(candYear, 10) || 0;
  if (wy && cy && Math.abs(wy - cy) > 1) return false;
  if (A === C) return true;
  if (A.replace(/ /g, '') === C.replace(/ /g, '')) return true;   // "spider man" == "spiderman"
  const toks = A.split(' ').filter(t => t.length > 1 && !/^(the|a|an|and|of|in|to|part|movie|film)$/.test(t));
  if (!toks.length) return false;
  const hc = C.split(' ');
  const hit = toks.filter(t => hc.indexOf(t) >= 0).length;
  if (hit === toks.length && hc.length <= toks.length + 3) return true;
  // last resort: compact containment ("SpiderManBrandNewDay2026" style slugs)
  const cc = C.replace(/ /g, ''), aa = A.replace(/ /g, '');
  return cc.indexOf(aa) >= 0 && cc.length <= aa.length + 12;
}

// Quality of one package label/heading ("4K UHD 2160p" -> 2160, "1080p FHD" -> 1080).
function qualityOf(text) {
  const s = String(text || '');
  if (/2160|\b4k\b|\buhd\b/i.test(s)) return 2160;
  if (/1080/.test(s)) return 1080;
  if (/720/.test(s)) return 720;
  if (/480/.test(s)) return 480;
  return 0;
}

// Split a /download/<slug> page into package records, newest markup only.
// Returns [{ q, label, size, drives: [ 'https://hubcloud.ist/drive/<id>' ] }]
// sorted by quality (desc). Blocks without a quality or without a HubCloud
// mirror are dropped: a card must point at a real file id.
function parsePackages(html) {
  const out = [];
  const parts = String(html || '').split('<div class="dl-package-card">').slice(1);
  for (const block of parts) {
    const label = ((block.match(/dl-package-quality[\s\S]{0,2000}?<span>([^<]{1,80})<\/span>/) || [])[1] || '').trim();
    const size = ((block.match(/dl-size-badge">([^<]{1,30})</) || [])[1] || '').trim();
    const q = qualityOf(label || block.slice(0, 400));
    const drives = [...block.matchAll(DRIVE_RE)]
      .map(m => 'https://hubcloud.ist/drive/' + m[1])
      .filter((v, i, a) => a.indexOf(v) === i);
    if (!q || !drives.length) continue;
    out.push({ q, label, size, drives });
  }
  return out.sort((a, b) => b.q - a.q);
}

module.exports = { norm, titleMatch, qualityOf, parsePackages, DRIVE_RE };
