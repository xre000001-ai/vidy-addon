import { apiFetch } from './http.js';
import { poolOnce } from './pool.js';
// Search core: POST /api/search?q=<title>&limit=20&page=1
//
// Primary source: movieboxonline.net's own search backend, the shared BFF
// `POST /wefeed-h5api-bff/subject/search`. That index is much richer than the
// old SSR page scrapes (~100+ hits for broad queries vs 12-19).
//
// Result order = movieboxonline.net's order, verbatim. The site's own search
// page calls the BFF with exactly this body (observed in the browser network
// log): {"keyword":...,"page":1,"perPage":0,"subjectType":0}. Any other
// perPage value changes both the item count and the tail ordering, so it must
// stay 0. Deeper results come from walking the BFF's own page sequence.
//
// The BFF search requires an auth token, minted the same way the
// movieboxonline.net frontend does for anonymous visitors:
//   1. POST /subject/search-suggest signed with
//      X-Client-Token: <unix-seconds>,<md5(reverse(unix-seconds-string))>
//   2. the response's `x-user` header carries a 90-day anonymous JWT
//   3. POST /subject/search with `Authorization: Bearer <jwt>`
//
// Fallback: if the BFF path fails, scrape the classic SSR search pages
// (netnaija.film first, then officialmoviebox.com, then movieboxonline.net)
// and parse their __NUXT_DATA__ blobs.

import crypto from "node:crypto";
import { API, SITE, UA, commonHeaders } from "./upstream.js";

// ---------------------------------------------------------------------------
// Anonymous JWT handling (module scope survives across warm invocations).
//
// The BFF A/B-tests its search ranking per anonymous uid: the uid embedded in
// the JWT decides which ranking variant you see (~75-80% of uids land in the
// majority variant; the head of the list is stable, the fuzzy tail is
// shuffled). A dedicated anonymous JWT is pinned so the API always returns
// the same order the site shows the overwhelming majority of visitors. If the
// pinned token is rejected or nears expiry, calibrateMajority() re-mints one
// that stays in the majority bucket (majority vote across 3 candidates).
// ---------------------------------------------------------------------------

// Dedicated anonymous identity in the majority rank bucket
// (uid 8687706835455468792, exp 2026-12-11). Purely anonymous - no account,
// no PII.
const PINNED_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjg2ODc3MDY4MzU0NTU0Njg3OTIsImF0cCI6MywiZXh0IjoiMTc4OTE4NTA5MSIsImV4cCI6MTc5Njk2MTA5MSwiaWF0IjoxNzg5MTg0NzkxfQ.Tqn8Ulm3swjwkJcF3mXWkI6JVsFlOLBPsCrGq_XAwsU";

let jwtState = { token: PINNED_JWT, fetchedAt: 0 };

function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function clientToken() {
  const e = Math.floor(Date.now() / 1000);
  const n = crypto.createHash("md5").update(String(e).split("").reverse().join("")).digest("hex");
  return `${e},${n}`;
}

function bffHeaders(extra = {}) {
  return {
    "User-Agent": UA,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Client-Info": '{"timezone":"Africa/Lagos"}',
    "X-Request-Lang": "en",
    Origin: SITE,
    Referer: SITE + "/",
    ...extra,
  };
}

/** Mint a fresh anonymous JWT (search-suggest with an empty Authorization). */
async function mintToken(keyword) {
  try {
    const r = await apiFetch(`${API}/wefeed-h5api-bff/subject/search-suggest`, {
      method: "POST",
      headers: bffHeaders({ Authorization: "", "X-Client-Token": clientToken() }),
      body: JSON.stringify({ keyword, perPage: 10 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const xuser = r.headers.get("x-user");
    if (!xuser) return null;
    const token = JSON.parse(xuser).token;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/** Fetch "try also" suggestion words. With a valid Bearer there is no x-user
 *  header at all, so this never churns the pinned identity. */
async function suggest(keyword) {
  try {
    const r = await apiFetch(`${API}/wefeed-h5api-bff/subject/search-suggest`, {
      method: "POST",
      headers: bffHeaders({ Authorization: `Bearer ${jwtState.token}` }),
      body: JSON.stringify({ keyword, perPage: 10 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const words = (data?.data?.items || [])
      .map((i) => i?.word)
      .filter((w) => typeof w === "string" && w.trim());
    return { token: jwtState.token, suggestions: [...new Set(words)].slice(0, 10) };
  } catch {
    return null;
  }
}

/** Mint a fresh identity that lands in the MAJORITY rank bucket: mint up to 3
 *  candidate tokens, fetch one search page with each, keep the candidate whose
 *  result order matches at least one other (majority vote). Falls back to the
 *  first successfully minted token when no agreement is found. */
async function calibrateMajority() {
  // v2.6.0 PARALLEL: mint+verify ALL candidates in ONE parallel round
  // (was 6 serial round-trips — every JWT-expiry window crawled).
  const minted = await Promise.all([mintToken("movie"), mintToken("movie"), mintToken("movie")]);
  const candidates = minted.filter(Boolean);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const orders = await Promise.all(candidates.map((t) => searchPageWith(t, "odyssey", 1).then(
    (sig) => (sig ? sig.items.map((i) => String(i?.subjectId || "")).join(",") : null)
  )));
  const counts = new Map();
  for (const sig of orders) if (sig) counts.set(sig, (counts.get(sig) || 0) + 1);
  let bestSig = null, bestN = 0;
  for (const [sig, n] of counts) if (n > bestN) { bestSig = sig; bestN = n; }
  if (bestN >= 2) {
    const idx = orders.indexOf(bestSig);
    if (idx >= 0) return candidates[idx];
  }
  return candidates[0];
}

async function ensureJwt() {
  if (!jwtState.token) {
    const t = await calibrateMajority();
    if (t) jwtState = { token: t, fetchedAt: Date.now() };
    return jwtState.token;
  }
  // Refresh only when the token is within 7 days of its real expiry.
  const exp = jwtExpiryMs(jwtState.token);
  if (exp && Date.now() > exp - 7 * 24 * 3600 * 1000) {
    const t = await calibrateMajority();
    if (t) jwtState = { token: t, fetchedAt: Date.now() };
  }
  return jwtState.token;
}

/** v2.11.1 (রোগ-নির্ণয় r134): MovieBox এখন /subject/play-এও Bearer-JWT চায়
 *  (টোকেন-ছাড়া = hasResource:false, খালি-streams — লাইভ-প্রমাণিত)। matrix/links/subtitles
 *  এই-এক-গেট থেকে টোকেন নেয়। */
export async function bearerToken() {
  try { return (await ensureJwt()) || jwtState.token || ''; } catch { return jwtState.token || ''; }
}

const MAX_BFF_PAGES = 10; // safety cap for the page walk

async function searchPage(keyword, page) {
  return searchPageWith(jwtState.token, keyword, page);
}

/** v2.9.1: two pool exits race the same POST (600ms apart); the first OK
 *  response wins.  Cuts the single-exit latency tail — still 100% pool
 *  (apiFetch), no direct path exists. */
async function hedgedPost(url, headers, body, { hedgeMs = 600, timeoutMs = 3500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const fire = (delay) => setTimeout(() => {
      if (settled) return;
      apiFetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) })
        .then((r) => {
          if (!r) return;
          if (r.status === 401 || r.status === 403) { settle({ unauthorized: true }); return; }
          if (r.ok) settle(r);
        })
        .catch(() => {});
    }, delay);
    fire(0); fire(hedgeMs);
    setTimeout(() => settle(null), timeoutMs + hedgeMs + 500);
  });
}

async function searchPageWith(token, keyword, page) {
  if (!token) return null;
  const r = await hedgedPost(
    `${API}/wefeed-h5api-bff/subject/search`,
    bffHeaders({ Authorization: `Bearer ${token}` }),
    JSON.stringify({ keyword, page, perPage: 0, subjectType: 0 })
  );
  if (!r) return null;
  if (r.unauthorized) return "UNAUTHORIZED";
  try {
    const data = await r.json();
    const items = data?.data?.items;
    if (!Array.isArray(items)) return null;
    return {
      total: data?.data?.pager?.totalCount ?? items.length,
      hasMore: !!data?.data?.pager?.hasMore,
      items,
    };
  } catch {
    return null;
  }
}

/** v2.9.5 GEO-CATALOG CONSENSUS (the "some titles show nothing" fix):
 *  different pool exits serve different geo rankings of the SAME index —
 *  a single call can land on a catalog view where the wanted title is
 *  crowded out by audio/music junk.  Page-0 is therefore sampled from
 *  THREE independent exits in parallel and the MAJORITY item-order wins
 *  (all calls still ride apiFetch — pool-only, policy untouched). */
const JUNK_RE = /🎧|8d|sleep ambient|lofi|ringtone|\bbgm\b|instrumental|karaoke|full video|video song|fingerstyle|piano cover/i;
const nz = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nonAscii = (s) => /[^\x00-\x7F]/.test(String(s || ""));
function setScore(r, wanted) {
  const w = nz(wanted);
  const wForeign = nonAscii(wanted || "");
  let sc = 0;
  for (const it of r.items) {
    const raw = String(it?.title || "");
    const t = nz(raw);
    if (!t || JUNK_RE.test(raw)) continue;
    // v2.9.6: a foreign-script variant ('JUJUTSU KAISEN [عربي]') normalizes to the
    // bare wanted name and used to win as EXACT — starving the ASCII multi-dub
    // subject that actually carries the Hindi dub. Cap it at noise level.
    const capped = nonAscii(raw) && !wForeign;
    if (capped) { sc = Math.max(sc, 1); continue; }
    if (t === w) return 4;
    if (t.startsWith(w) || w.startsWith(t)) sc = Math.max(sc, 3);
    else if (t.includes(w) || w.includes(t)) sc = Math.max(sc, 2);
    else sc = Math.max(sc, 1);
  }
  return sc;
}
async function searchConsensus(keyword, page, wanted) {
  // v2.9.9 EARLY-EXIT: যেকোনো-exit-যখনই-কাঙ্ক্ষিত-টাইটেল-নাম-মেনে-ফেরত-দেয় (score >= 3),
  // তখনই-সেটেল — exact/prefix-ম্যাচের-পরে-majority-ভোট-আর-উন্নতি-করে-না, শুধু-লেটেন্সি-যোগ-করে
  // (আগে-তিনটার-জন্য-অপেক্ষা → search ~2.9s; প্রথম-শক্তিশালী-সেট ~1.2s-এ-আসে)।
  // অস্পষ্ট/জাংক-সেট-আগের-মতোই-majority-ভোটে-পড়ে।
  return new Promise((resolve) => {
    let left = 3, settled = false, best = null, bs = -1; const okRs = [];
    const fin = (v) => { if (!settled) { settled = true; resolve(v); } };
    const onDone = () => {
      if (!okRs.length) return fin(null);
      if (bs >= 3) return fin(best);
      // no set contains the title well: majority catalog keeps the index sane
      const counts = new Map();
      for (const r of okRs) {
        const sig = r.items.map(i => String(i?.subjectId || "")).join(",");
        counts.set(sig, (counts.get(sig) || 0) + 1);
      }
      let bestSig = null, bn = 0;
      for (const [sig, cnt] of counts) if (cnt > bn) { bn = cnt; bestSig = sig; }
      if (bn >= 2) return fin(okRs.find(r => r.items.map(i => String(i?.subjectId || "")).join(",") === bestSig));
      return fin(best);
    };
    for (let i = 0; i < 3; i++) {
      searchPage(keyword, page).then((r) => {
        if (settled) return;
        if (r === "UNAUTHORIZED") return fin("UNAUTHORIZED");
        if (r && r.items && r.items.length) {
          okRs.push(r);
          const sc = setScore(r, wanted || keyword);
          if (sc > bs) { bs = sc; best = r; }
          if (sc >= 3) return fin(best);
        }
        if (--left === 0) onDone();
      }).catch(() => { if (!settled && --left === 0) onDone(); });
    }
  });
}

/** Walk the BFF's own page sequence until the limit is filled or the index
 *  ends. Items are appended strictly in response order; a subjectId-level
 *  dedupe guards against a result drifting across a page boundary. */
async function bffSearch(keyword, page, limit) {
  await ensureJwt();
  const all = [];
  const seen = new Set();
  let total = 0;
  let hasMore = false;
  let anyPageSucceeded = false;
  // v2.9.4: prefetch the NEXT page while the current one is being folded in
  // (the walk used to be strictly serial; JOIN dedupes overlaps)
  let nextP = null;
  for (let p = 0; p < MAX_BFF_PAGES; p++) {
    if (all.length >= limit) break;
    let res = nextP ? await nextP : (p === 0 ? await searchConsensus(keyword, page + p, keyword) : await searchPage(keyword, page + p));
    nextP = null;
    if (res && res !== "UNAUTHORIZED" && res.items.length) {
      const total = res.total || 0;
      if (all.length + res.items.length < Math.min(limit, total || 1e9)) {
        nextP = searchPage(keyword, page + p + 1);
      }
    }
    if (res === "UNAUTHORIZED") {
      const t = await calibrateMajority();
      jwtState = { token: t, fetchedAt: Date.now() };
      if (!jwtState.token) break;
      res = await searchPage(keyword, page + p);
      if (res === "UNAUTHORIZED" || res === null) break;
    }
    if (res === null || res === undefined) {
      if (p === 0) return null; // primary source broken -> SSR fallback
      break; // later page failed -> serve what we already have
    }
    // v2.4.1: a pool exit can serve a lying EMPTY first page (geo
    // catalog, status 200).  3 different exits must AGREE on empty;
    // if they do, the whole bench is suspicious -> force a fresh pool
    // pass (new candidate wave, search-verified) and try once more.
    if (p === 0 && res.items.length === 0) {
      let allEmpty = true;
      for (let k = 0; k < 2; k++) {
        await new Promise((r) => setTimeout(r, 250));
        const res2 = await searchPage(keyword, page);
        if (res2 && res2 !== "UNAUTHORIZED" && res2.items.length) {
          res = res2;
          allEmpty = false;
          break;
        }
      }
      if (allEmpty) {
        await poolOnce(true);            // fresh, search-verified exits
        const res3 = await searchPage(keyword, page);
        if (res3 && res3 !== "UNAUTHORIZED" && res3.items.length) {
          res = res3;
        }
      }
    }
    anyPageSucceeded = true;
    total = res.total;
    hasMore = res.hasMore;
    let added = 0;
    for (const item of res.items) {
      const id = String(item?.subjectId || item?.id || item?.detailPath || "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(item);
      added++;
    }
    if (res.items.length === 0 || !res.hasMore) break;
    if (added === 0 && p > 0) break;
  }
  if (!anyPageSucceeded) return null;
  const items = all.slice(0, limit);
  return { total, hasMore: items.length < all.length ? true : hasMore, items };
}

/** Normalize a BFF search item into the public response shape. */
function normItem(s) {
  if (!s) return null;
  return {
    title: s.title || "",
    subjectId: String(s.subjectId || s.id || ""),
    subjectType: s.subjectType,
    detailPath: s.detailPath || "",
    type: s.subjectType === 1 ? "movie" : s.subjectType === 2 ? "tv" : "other",
    genre: s.genre || "",
    imdbRating: s.imdbRatingValue || s.imdbRating || "",
    imdbRatingValue: s.imdbRatingValue || "",
    imdbRatingCount: s.imdbRatingCount || 0,
    country: s.countryName || "",
    description: s.description || "",
    releaseDate: s.releaseDate || "",
    duration: s.duration || 0,
    cover: s.cover?.url || (typeof s.cover === "string" ? s.cover : "") || "",
    hasResource: s.hasResource || false,
  };
}

// ---------------------------------------------------------------------------
// Fallback: classic SSR search page scrape (__NUXT_DATA__ parsing)
// ---------------------------------------------------------------------------

function resolveNuxt(nuxt, obj) {
  // NUXT_DATA stores objects whose integer values reference array indices.
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => resolveNuxt(nuxt, v));

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "number" && val >= 0 && val < nuxt.length) {
      const resolved = nuxt[val];
      if (typeof resolved === "object" && resolved !== null) {
        result[key] = resolveNuxt(nuxt, resolved);
      } else {
        result[key] = resolved;
      }
    } else if (typeof val === "object" && val !== null) {
      result[key] = resolveNuxt(nuxt, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function extractSubjectsFromNuxt(nuxt) {
  const results = [];
  const seen = new Set();
  for (let i = 0; i < nuxt.length; i++) {
    const item = nuxt[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const hasSubjectId = "subjectId" in item || "subjectID" in item;
    const hasDetailPath = "detailPath" in item;
    const hasTitle = "title" in item;
    if ((hasSubjectId || hasDetailPath) && hasTitle) {
      const resolved = resolveNuxt(nuxt, item);
      if (resolved.title && resolved.detailPath) {
        const sid = String(resolved.subjectId || resolved.id || resolved.detailPath);
        if (!seen.has(sid)) {
          seen.add(sid);
          const norm = normItem(resolved);
          if (norm) results.push(norm);
        }
      }
    }
  }
  return results;
}

/** Entry point. params: { q, limit, page } -> { status, body }. */
export async function run(params) {
  const q = String(params.q || "").trim();
  const limit = Math.min(parseInt(params.limit) || 20, 60);
  const page = Math.max(parseInt(params.page) || 1, 1);

  if (!q) {
    return { status: 400, body: { error: "Missing q parameter. Example: /api/search?q=one+piece" } };
  }

  // Primary: movieboxonline.net BFF search (rich index + suggestions).
  const [searchRes, sugg] = await Promise.all([bffSearch(q, page, limit), suggest(q)]);
  if (searchRes) {
    const results = searchRes.items.map(normItem).filter(Boolean);
    return {
      status: 200,
      body: {
        query: q,
        count: results.length,
        total: searchRes.total,
        page,
        hasMore: searchRes.hasMore,
        results,
        suggestions: (sugg?.suggestions || []).slice(0, 8),
        source: "movieboxonline",
      },
    };
  }

  // Fallback: SSR search page scrape.
  const encoded = encodeURIComponent(q);
  const seen = new Set();
  const results = [];
  const sites = [
    `https://netnaija.film/search-result?keyword=${encoded}`,
    `https://officialmoviebox.com/newWeb/searchResult?keyword=${encoded}`,
    `https://movieboxonline.net/search-result?keyword=${encoded}`,
  ];
  for (const siteUrl of sites) {
    try {
      const r = await apiFetch(siteUrl, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const nuxt = JSON.parse(m[1]);
      const subjects = extractSubjectsFromNuxt(nuxt);
      for (const s of subjects) {
        if (s && s.title && !seen.has(s.subjectId)) {
          seen.add(s.subjectId);
          results.push(s);
        }
      }
      if (results.length > 0) break;
    } catch {}
  }

  return {
    status: 200,
    body: {
      query: q,
      count: Math.min(results.length, limit),
      total: results.length,
      page,
      results: results.slice(0, limit),
      suggestions: [],
      source: results.length > 0 ? "ssr-fallback" : "none",
    },
  };
}
