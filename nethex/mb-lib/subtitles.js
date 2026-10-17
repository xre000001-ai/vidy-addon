// Subtitles core: GET /api/subtitles?id=<detailPath>&season=1&episode=1
// Subtitle files for a movie or TV episode, one per language. For movies omit
// season/episode. `id` is the detailPath returned by /api/search or
// /api/trending.
//
// Flow: resolve a playable video id from /subject/play (fallback
// /subject/download), then call /subject/caption. Each caption's `url` points
// at a .srt file on cacdn.hakunaymatata.com - a plain signed link that works
// from any HTTP client without special headers.

import { API, SITE, commonHeaders, fetchJson } from "./upstream.js";

/** Entry point. params: { id, season, episode } -> { status, body }. */
export async function run(params) {
  const detailPath = String(params.id || params.detailPath || "").trim();

  if (!detailPath) {
    return {
      status: 400,
      body: { error: "Missing id parameter. Example: /api/subtitles?id=lucifer-UQASHYbVPB2&season=1&episode=1" },
    };
  }

  // 1. Resolve the subject (movie vs tv decides the se/ep sent upstream).
  const detailResp = await fetchJson(
    `${API}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders()
  );
  if (!detailResp.ok || !detailResp.data) {
    return { status: 502, body: { error: "Failed to fetch detail", detailPath, status: detailResp.status } };
  }
  const subject = detailResp.data?.data?.subject;
  if (!subject) {
    return { status: 404, body: { error: "Subject not found", detailPath } };
  }

  const isTv = subject.subjectType === 2;
  const season = isTv ? Math.max(parseInt(params.season) || 1, 1) : 0;
  const episode = isTv ? Math.max(parseInt(params.episode) || 1, 1) : 0;
  const subjectId = String(subject.subjectId);
  const title = subject.title || "";
  const playReferer = `${SITE}/play/${detailPath}`;

  // 2. Resolve a playable video id (play first, download as fallback).
  let videoId = "";
  let streamSource = "";

  const playResp = await fetchJson(
    `${API}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders(playReferer)
  );
  const playStreams = playResp.data?.data?.streams || [];
  if (playStreams.length > 0) {
    const free = playStreams
      .filter((s) => s.url && !s.vipLocked)
      .sort((a, b) => (b.resolutions || 0) - (a.resolutions || 0));
    const chosen = free[0] || playStreams[0];
    videoId = String(chosen?.id || "");
    streamSource = "play";
  }

  if (!videoId) {
    const dlResp = await fetchJson(
      `${SITE}/wefeed-h5api-bff/subject/download?subjectId=${subjectId}&se=${season}&ep=${episode}&detailPath=${encodeURIComponent(detailPath)}`,
      commonHeaders(playReferer)
    );
    const dlDownloads = dlResp.data?.data?.downloads || [];
    if (dlDownloads.length > 0) {
      const free = dlDownloads
        .filter((d) => d.url && !d.vipLocked)
        .sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
      const chosen = free[0] || dlDownloads[0];
      videoId = String(chosen?.id || chosen?.videoId || "");
      streamSource = "download";
    }
  }

  if (!videoId) {
    return {
      status: 404,
      body: {
        error: "No playable video id found. The play endpoint may be rate-limited; retry in 2-3 minutes.",
        detailPath,
        season,
        episode,
        title,
      },
    };
  }

  // 3. Fetch the caption list for that video id.
  const captionResp = await fetchJson(
    `${API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${videoId}&subjectId=${subjectId}&detailPath=${encodeURIComponent(detailPath)}`,
    commonHeaders(playReferer)
  );
  if (!captionResp.ok || !captionResp.data) {
    return { status: 502, body: { error: "Failed to fetch captions", detailPath, status: captionResp.status } };
  }

  const captions = (captionResp.data?.data?.captions || []).map((c) => ({
    id: String(c.id || ""),
    lan: c.lan || "",
    lanName: c.lanName || "",
    url: c.url || "",
    size: parseInt(c.size || 0),
    delay: c.delay || 0,
  }));

  return {
    status: 200,
    body: {
      detailPath,
      subjectId,
      title,
      type: isTv ? "tv" : "movie",
      season,
      episode,
      videoId,
      streamSource,
      captionCount: captions.length,
      captions,
    },
  };
}
