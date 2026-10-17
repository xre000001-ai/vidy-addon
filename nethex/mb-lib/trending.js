// Trending core: GET /api/trending?limit=20
// Current trending list with rich fields (cover, rating, genre, country...).

import { API, commonHeaders, fetchJson } from "./upstream.js";

/** Entry point. params: { limit } -> { status, body }. */
export async function run(params) {
  const limit = Math.min(parseInt(params.limit) || 20, 100);

  const resp = await fetchJson(
    `${API}/wefeed-h5api-bff/subject/trending?page=1&perPage=${limit}`,
    commonHeaders()
  );

  if (!resp.ok) {
    return { status: resp.status, body: { error: `Upstream returned ${resp.status}` } };
  }

  const items = resp.data?.data?.subjectList || resp.data?.data || [];
  return {
    status: 200,
    body: {
      count: items.length,
      items: items.map((m) => ({
        title: m.title || "",
        subjectId: String(m.subjectId || ""),
        subjectType: m.subjectType,
        detailPath: m.detailPath || "",
        type: m.subjectType === 1 ? "movie" : "tv",
        description: m.description || "",
        releaseDate: m.releaseDate || "",
        duration: m.duration || 0,
        genre: m.genre || "",
        cover: m.cover?.url || "",
        countryName: m.countryName || "",
        imdbRatingValue: m.imdbRatingValue || "",
        imdbRatingCount: m.imdbRatingCount || 0,
        subtitles: m.subtitles || "",
        hasResource: !!m.hasResource,
        imdbRating: m.imdbRatingValue || "",
      })),
    },
  };
}
