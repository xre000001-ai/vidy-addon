// Details core: GET /api/details?id=<detailPath>
// Full metadata for a movie or show: title, synopsis, cast, dubs (alternative
// audio / subtitle language variants), trailer - plus, for TV shows, the
// season list with episode counts and available resolutions.
// `id` is the detailPath returned by /api/search or /api/trending.

import { API, commonHeaders, fetchJson } from "./upstream.js";

function fmtDuration(sec) {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Fetch the raw /detail payload (or null when unusable). */
async function fetchDetail(detailPath) {
  const resp = await fetchJson(
    `${API}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders()
  );
  if (!resp.ok || !resp.data) {
    return { errorStatus: resp.status || 502 };
  }
  const subject = resp.data?.data?.subject;
  if (!subject) return { notFound: true };
  return { data: resp.data };
}

/** Entry point. params: { id } -> { status, body }. */
export async function run(params) {
  const detailPath = String(params.id || params.detailPath || "").trim();

  if (!detailPath) {
    return {
      status: 400,
      body: { error: "Missing id parameter. Example: /api/details?id=oppenheimer-Akh5Nrwl7o" },
    };
  }

  const detail = await fetchDetail(detailPath);
  if (detail.errorStatus) {
    return { status: detail.errorStatus, body: { error: `Upstream returned ${detail.errorStatus}`, detailPath } };
  }
  if (detail.notFound) {
    return { status: 404, body: { error: "Subject not found", detailPath } };
  }

  const data = detail.data;
  const subject = data.data.subject;

  const cast = (data.data.stars || []).map((s) => ({
    staffId: String(s.staffId || ""),
    staffType: s.staffType,
    role: s.staffType === 1 ? "Cast" : s.staffType === 2 ? "Director" : "Staff",
    name: s.name || "",
    character: s.character || "",
    avatarUrl: s.avatarUrl || "",
    detailPath: s.detailPath || "",
  }));

  // Dubs / alternative audio + subtitle language variants.
  // type: 0 = dubbed audio track, 1 = subtitle-language variant.
  // `original` is true for the original-language track.
  const dubs = (subject.dubs || []).map((d) => ({
    subjectId: String(d.subjectId || ""),
    lanName: d.lanName || "",
    lanCode: d.lanCode || "",
    original: !!d.original,
    type: d.type,
    kind: d.type === 1 ? "subtitle" : "dub",
    detailPath: d.detailPath || "",
  }));

  const resource = data.data.resource || {};
  const seasons = subject.subjectType === 2
    ? (resource.seasons || []).map((s) => ({
        season: s.se,
        maxEp: s.maxEp || 0,
        resolutions: (s.resolutions || []).map((r) => r.resolution),
      }))
    : [];
  const allRes = new Set();
  seasons.forEach((s) => s.resolutions.forEach((r) => allRes.add(r)));

  const trailer = subject.trailer || {};
  const trailerVideo = trailer.videoAddress || {};

  return {
    status: 200,
    body: {
      detailPath,
      subjectId: String(subject.subjectId || ""),
      subjectType: subject.subjectType,
      type: subject.subjectType === 1 ? "movie" : "tv",
      title: subject.title || "",
      description: subject.description || data.data.metadata?.description || "",
      genre: subject.genre || "",
      releaseDate: subject.releaseDate || "",
      duration: subject.duration || 0,
      durationText: fmtDuration(subject.duration || 0),
      imdbRatingValue: subject.imdbRatingValue || "",
      imdbRatingCount: subject.imdbRatingCount || 0,
      countryName: subject.countryName || "",
      subtitles: subject.subtitles || "",
      cover: subject.cover?.url || "",
      coverWidth: subject.cover?.width || 0,
      coverHeight: subject.cover?.height || 0,
      hasResource: !!subject.hasResource,
      trailer: {
        url: trailerVideo.url || "",
        videoId: String(trailerVideo.videoId || ""),
        duration: trailerVideo.duration || 0,
        width: trailerVideo.width || 0,
        height: trailerVideo.height || 0,
        cover: trailer.cover?.url || "",
      },
      cast,
      castCount: cast.length,
      dubs,
      dubCount: dubs.length,
      // TV only: season list with episode counts and resolutions.
      seasonCount: seasons.length,
      totalEpisodes: seasons.reduce((sum, s) => sum + (s.maxEp || 0), 0),
      globalResolutions: [...allRes].sort((a, b) => a - b),
      source: resource.source || "",
      uploadBy: resource.uploadBy || "",
      seasons,
    },
  };
}
