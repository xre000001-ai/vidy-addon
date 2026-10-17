// Episode-matrix core: GET /api/episode-matrix?id=<detailPath>&season=1&episode=1
// The composite endpoint for multi-language clients: the FULL language matrix
// for one episode (or a whole movie) in a single call.
//   - one entry per dub variant (Original Audio + every language dub), each
//     with its own playable qualities (resolution/size/url)
//   - the AGGREGATED subtitle set: captions collected from every variant that
//     has streams, deduped per language (the Original Audio variant usually
//     carries the richest caption set while dub variants carry none; the
//     union is returned once so clients get every language in one call)
//   - ttlHint: seconds the returned CDN urls stay valid (video sign urls
//     live for hours, caption urls for days; a conservative 2h is advertised)
//
// For movies omit season/episode - the same language matrix is returned
// without episode routing.
//
// All dub variants of an entry share the BFF subject model: each variant is
// its own subject with its own subjectId/detailPath, and /subject/play is
// queried per variant with the variant's OWN play URL as referer (the BFF
// validates the referer's detailPath against the requested variant - using
// the base entry's referer returns 0 streams for dub variants). Calls run
// in parallel (typically 2-6 variants).

import { API, SITE, commonHeaders } from "./upstream.js";
import { fetchJsonRotating } from "./pool.js";
import { playToken } from "./search.js"; // v2.11.1: the token is mandatory on play (not a hub order — a new MovieBox gate)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Play streams for one variant; falls back to the download endpoint.
 *  v2.4.0 RETRY-UNTIL-REAL-EMPTY: every attempt rides a DIFFERENT pool
 *  exit (fetchJsonRotating).  A variant is declared empty only after
 *  2 rounds x (2 play + 2 download) fresh-exit attempts all came back
 *  empty — a geo/churn window on one exit can no longer eat streams. */
async function variantStreams(subjectId, detailPath, season, episode) {
  const referer = `${SITE}/play/${detailPath}`;
  const playUrl = `${API}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`;
  const dlUrl = `${SITE}/wefeed-h5api-bff/subject/download?subjectId=${subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`;
  const bt = await playToken();
  const H = bt ? { ...commonHeaders(referer), Authorization: `Bearer ${bt}` } : commonHeaders(referer);
  let streams = [];
  for (let round = 0; round < 2; round++) {
    // v2.6.0 PARALLEL: play+download race TOGETHER (was sequential —
    // empty-play variants paid an extra full round-trip); both ride
    // hedged rotating exits (parallel search across proxies).
    // v2.11.1 (// v2.11.1 (r134 diagnosis): play has a per-IP rate limit (~1 per 2-3 min) — rotating many distinct exits grows the quota
    const [res, res2] = await Promise.all([
      fetchJsonRotating(playUrl, H, { attempts: 3, ms: 2200, hedgeMs: 0, emptyCheck: (d) => !((d?.data?.streams || []).length) }), // v2.11.5: two exits race together (hedge 0) — first content wins in ~1-2.2s
      fetchJsonRotating(dlUrl, H, { attempts: 2, ms: 2000, hedgeMs: 0, emptyCheck: (d) => !((d?.data?.downloads || []).length) }),
    ]);
    streams = res.ok ? res.data?.data?.streams || [] : [];
    if (streams.length === 0) {
      streams = res2.ok ? res2.data?.data?.downloads || [] : [];
    }
    if (streams.length > 0 || round === 1) break;
    await sleep(250);
  }
  return streams;
}

/** Captions for one variant, using its highest-res stream's videoId. */
async function variantCaptions(subjectId, detailPath, season, episode, videoId) {
  if (!videoId) return [];
  const referer = `${SITE}/play/${detailPath}`;
  const bt2 = await playToken();
  const res = await fetchJsonRotating(
    `${API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${videoId}&subjectId=${subjectId}&detailPath=${encodeURIComponent(detailPath)}`,
    bt2 ? { ...commonHeaders(referer), Authorization: `Bearer ${bt2}` } : commonHeaders(referer), { attempts: 2, ms: 3000, hedgeMs: 600 }
  );
  if (!res.ok) return [];
  return (res.data?.data?.captions || [])
    .map((c) => ({
      lanName: c.lanName || c.lan || "",
      lanCode: c.lan || "",
      url: c.url || "",
      size: parseInt(c.size || 0),
    }))
    .filter((c) => c.url);
}

function normQuality(s) {
  return {
    resolution: parseInt(s.resolutions || s.resolution || 0),
    size_mb: Math.round((parseInt(s.size || 0) / 1e6) * 100) / 100,
    duration_sec: s.duration || 0,
    codec: s.codecName || "h264",
    vipLocked: s.vipLocked || false,
    url: s.url || "",
    videoId: String(s.id || ""),
  };
}

// v2.9.1 DETAIL CACHE: every episode of a series re-pays the SAME detail
// round-trip; a 30min cache makes binge navigation near-instant.  Pure
// upper-layer caching — the pool path itself is untouched.
const DETAIL_TTL = 30 * 60 * 1000;
const DETAIL_MAX = 300;
const detailCache = new Map();   // detailPath -> { at, data }
async function getDetail(detailPath) {
  const e = detailCache.get(detailPath);
  if (e && Date.now() - e.at < DETAIL_TTL) return { ok: true, status: 200, data: e.data };
  let detail = await fetchJsonRotating(
    `${API}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders(), { attempts: 2, ms: 3500, hedgeMs: 700 }
  );
  if (!detail.ok || !detail.data) {
    // v2.4.0: one more full rotating round before "subject not found" —
    // a real miss needs several DIFFERENT exits agreeing
    await sleep(300);
    detail = await fetchJsonRotating(
      `${API}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
      commonHeaders(), { attempts: 3, ms: 3500, hedgeMs: 700 }
    );
  }
  if (detail.ok && detail.data) {
    if (!detailCache.has(detailPath) && detailCache.size >= DETAIL_MAX) {
      detailCache.delete(detailCache.keys().next().value);
    }
    detailCache.set(detailPath, { at: Date.now(), data: detail.data });
  }
  return detail;
}

/** Entry point. params: { id, season, episode } -> { status, body }. */
export function run(params) {
  // v2.11.7 overall budget: the primary matrix path was the last unbudgeted crawl
  // (live ring proof: "matrix +33491ms" on a degraded pool). Bound it — the child
  // wall (12s) answers the user first anyway; this only bounds the in-flight chain
  // so the cache heals on a later tap instead of every tap joining a 30s+ crawl.
  return Promise.race([
    runInner(params),
    new Promise((r) => setTimeout(() => r({ status: 504, body: { error: "matrix budget (14s)" } }), 14000)),
  ]);
}

async function runInner(params) {
  const detailPath = String(params.id || params.detailPath || "").trim();
  const season = parseInt(params.season) || 0; // 0 = movie
  const episode = parseInt(params.episode) || 0;

  if (!detailPath) {
    return {
      status: 400,
      body: {
        error: "Missing id parameter. Example: /api/episode-matrix?id=dandadan-cILcsymG0R1&season=1&episode=1",
      },
    };
  }

  const detail = await getDetail(detailPath);
  if (!detail.ok || !detail.data) {
    return {
      status: detail.status || 502,
      body: { error: `Upstream returned ${detail.status || 0}`, detailPath },
    };
  }
  const subject = detail.data?.data?.subject;
  if (!subject) {
    return { status: 404, body: { error: "Subject not found", detailPath } };
  }

  // Language variants: raw BFF dub entries carry `type` (0 = dubbed audio,
  // 1 = subtitle-language variant) and `original` (true = Original Audio).
  // Only type 0 is kept - hardsubbed releases (type 1) are skipped; the
  // aggregated soft captions cover those languages.
  //
  // EMPTY-dubs fallback: some entries have NO dub variants while the streams
  // live on the MAIN subject (movies especially). The main subject is then
  // treated as one unnamed Original Audio variant - otherwise the matrix
  // would return zero languages and clients would show nothing playable.
  const dubsRaw = (subject.dubs || []).filter((d) => d.type === 0 && d.detailPath);
  const dubs = dubsRaw.length > 0
    ? dubsRaw
    : [
        {
          subjectId: String(subject.subjectId),
          lanName: "",
          lanCode: "",
          original: true,
          type: 0,
          detailPath,
        },
      ];

  const isTv = subject.subjectType === 2;
  const se = isTv ? Math.max(season, 1) : 0;
  const ep = isTv ? Math.max(episode, 1) : 0;
  const seasons = detail.data?.data?.resource?.seasons || [];
  const seasonInfo = isTv && seasons.length > 0 ? seasons.find((s) => s.se === se) || null : null;

  // Streams for every variant, in parallel (each with its OWN referer)
  const streamResults = await Promise.all(
    dubs.map((d) =>
      variantStreams(String(d.subjectId || subject.subjectId), d.detailPath, se, ep).then(
        (streams) => ({ dub: d, streams })
      )
    )
  );

  // Captions: query variants that HAVE streams. Original Audio first (it
  // carries the richest caption set), then any dub variant. Union per
  // language, first (richest) wins.
  const captionVariants = streamResults
    .filter((r) => r.streams.length > 0)
    .sort((a, b) => (b.dub.original ? 1 : 0) - (a.dub.original ? 1 : 0));
  const captionLists = await Promise.all(
    captionVariants.map((r) => {
      const free = r.streams
        .filter((s) => s.url && !s.vipLocked)
        .sort((a, b) => (b.resolutions || b.resolution || 0) - (a.resolutions || a.resolution || 0));
      const chosen = free[0] || r.streams[0];
      return variantCaptions(
        String(r.dub.subjectId || subject.subjectId),
        r.dub.detailPath,
        se,
        ep,
        String(chosen?.id || "")
      );
    })
  );
  const seenLan = new Set();
  const subtitles = [];
  for (const list of captionLists) {
    for (const cap of list) {
      const key = (cap.lanName || cap.lanCode || "").toLowerCase();
      if (!key || seenLan.has(key)) continue;
      seenLan.add(key);
      subtitles.push(cap);
    }
  }

  // Assemble the language matrix (variants without streams are dropped)
  const languages = streamResults
    .filter((r) => r.streams.length > 0)
    .map((r) => ({
      lanName: r.dub.lanName || "",
      lanCode: r.dub.lanCode || "",
      original: !!r.dub.original,
      kind: r.dub.original ? "original" : "dub",
      detailPath: r.dub.detailPath,
      subjectId: String(r.dub.subjectId || ""),
      qualities: r.streams
        .map(normQuality)
        .filter((q) => q.url && !q.vipLocked)
        .sort((a, b) => b.resolution - a.resolution),
    }))
    .filter((l) => l.qualities.length > 0);

  return {
    status: 200,
    body: {
      title: subject.title || "",
      detailPath,
      subjectType: subject.subjectType,
      type: isTv ? "tv" : "movie",
      season: isTv ? se : 0,
      episode: isTv ? ep : 0,
      seasonInfo: seasonInfo
        ? {
            season: seasonInfo.se,
            maxEp: seasonInfo.maxEp,
            resolutions: seasonInfo.resolutions?.map((r) => r.resolution) || [],
          }
        : null,
      languageCount: languages.length,
      languages,
      subtitleCount: subtitles.length,
      subtitles,
      fetchedAt: Math.floor(Date.now() / 1000),
      ttlHint: 7200,
    },
  };
}
