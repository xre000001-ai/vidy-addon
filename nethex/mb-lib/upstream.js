import { apiFetch } from './http.js';
// Shared upstream access for the MovieBox backend (h5-api.aoneroom.com),
// the API behind movieboxonline.net, netnaija.film and officialmoviebox.com.

export const API = "https://h5-api.aoneroom.com";
export const SITE = "https://movieboxonline.net";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export function commonHeaders(referer) {
  return {
    "User-Agent": UA,
    Accept: "application/json",
    "X-Client-Info": '{"timezone":"Africa/Lagos"}',
    Origin: SITE,
    Referer: referer || SITE + "/",
  };
}

/** GET a URL and parse JSON, aborting after `ms` milliseconds.
 *  Returns { ok, status, data } - data is null when the body is not JSON. */
export async function fetchJson(url, headers, ms = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await apiFetch(url, { headers, signal: controller.signal });
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timeout);
  }
}
