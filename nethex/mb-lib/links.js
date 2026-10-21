// Links core: the shared engine behind /api/movie and /api/tv.
// Direct MP4 URLs for every quality (360P..1080P) of a movie or a TV
// episode.
//
// Upstream strategy: /subject/play first (1080P included free, but rate
// limited to ~1 successful call per 2-3 minutes per IP), then /subject/download
// via the site proxy as a fallback (1080P comes back VIP-locked there).
//
// The returned URLs are signed CDN links that expire after a few hours - fetch
// them fresh when needed instead of storing them.

import { API, SITE, commonHeaders, fetchJson } from "./upstream.js";

/** Fetch the subject + season info for a detailPath (or an error marker). */
async function fetchSubject(detailPath) {
  const resp = await fetchJson(
    `${API}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders()
  );
  if (!resp.ok || !resp.data) {
    return { errorStatus: resp.status || 502 };
  }
  const subject = resp.data?.data?.subject;
  if (!subject) return { notFound: true };
  return { subject, resource: resp.data.data.resource || {} };
}

function normalizeQualities(streams) {
  return streams.map((s) => ({
    resolution: parseInt(s.resolutions || s.resolution || 0),
    size_mb: Math.round(parseInt(s.size || 0) / 1e6 * 100) / 100,
    duration_sec: s.duration || 0,
    codec: s.codecName || "h264",
    vipLocked: s.vipLocked || false,
    url: s.url || "",
  }));
}

/** Generic entry point. params: { id, season, episode } -> { status, body }.
 *  The subject's own type decides movie vs episode routing. */
export async function run(params) {
  const detailPath = String(params.id || params.detailPath || "").trim();

  if (!detailPath) {
    return {
      status: 400,
      body: { error: "Missing id parameter. Example: /api/links?id=oppenheimer-Akh5Nrwl7o" },
    };
  }

  const sub = await fetchSubject(detailPath);
  if (sub.errorStatus) {
    return { status: sub.errorStatus, body: { error: `Upstream returned ${sub.errorStatus}`, detailPath } };
  }
  if (sub.notFound) {
    return { status: 404, body: { error: "Subject not found", detailPath } };
  }

  const subject = sub.subject;
  const isTv = subject.subjectType === 2;
  const season = isTv ? Math.max(parseInt(params.season) || 1, 1) : 0;
  const episode = isTv ? Math.max(parseInt(params.episode) || 1, 1) : 0;

  const playReferer = `${SITE}/play/${detailPath}`;
  const playResp = await fetchJson(
    `${API}/wefeed-h5api-bff/subject/play?subjectId=${subject.subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders(playReferer)
  );

  let streams = playResp.data?.data?.streams || [];
  let source = "play";

  if (streams.length === 0) {
    const dlResp = await fetchJson(
      `${SITE}/wefeed-h5api-bff/subject/download?subjectId=${subject.subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`,
      commonHeaders(playReferer)
    );
    streams = (dlResp.data?.data?.downloads || []).map((d) => ({
      ...d,
      resolutions: String(d.resolution),
    }));
    source = "download";
  }

  const qualities = normalizeQualities(streams);
  const body = {
    title: subject.title || "",
    subjectId: String(subject.subjectId || ""),
    detailPath,
    type: isTv ? "tv" : "movie",
    watch_url: `${SITE}/play/${detailPath}`,
    source,
    qualities,
    best_free: qualities
      .filter((q) => q.url && !q.vipLocked)
      .sort((a, b) => b.resolution - a.resolution)[0] || null,
  };

  if (isTv) {
    body.season = season;
    body.episode = episode;
    body.available_seasons = (sub.resource.seasons || []).map((s) => ({
      season: s.se,
      maxEp: s.maxEp,
      resolutions: (s.resolutions || []).map((r) => r.resolution),
    }));
  }

  return { status: 200, body };
}

/** /api/movie entry: same resolution, but rejects TV subjects so the split
 *  between the two endpoints stays obvious to API consumers. */
export async function runMovie(params) {
  const r = await run(params);
  if (r.status === 200 && r.body.type !== "movie") {
    return {
      status: 400,
      body: {
        error: `This subject is a ${r.body.type}. Use /api/tv with season and episode instead.`,
        detailPath: r.body.detailPath,
      },
    };
  }
  return r;
}

/** /api/tv entry: same resolution, but rejects movie subjects. */
export async function runTv(params) {
  const r = await run(params);
  if (r.status === 200 && r.body.type !== "tv") {
    return {
      status: 400,
      body: {
        error: `This subject is a ${r.body.type}. Use /api/movie instead.`,
        detailPath: r.body.detailPath,
      },
    };
  }
  return r;
}
