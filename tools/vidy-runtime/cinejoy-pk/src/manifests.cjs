'use strict';
// Text-only HLS selection. This module NEVER fetches, relays or transforms media.
const zlib = require('node:zlib');
const { attributes } = require('./hls.cjs');
const { safeURL, MEDIA_SUFFIXES } = require('./policy.cjs');
const { PKError } = require('./errors.cjs');
const PREFIX = '/cinejoy/hls/';
const MAX_TEXT = 32768, MAX_TOKEN = 8000;
function mediaURL(value) {
  const url = safeURL(value), host = new URL(url).hostname;
  if (!MEDIA_SUFFIXES.some(s => host === s || host.endsWith('.' + s))) throw new PKError('POLICY_HOST', 'Not a CineJoy media origin');
  return url;
}
function absolute(line, base) {
  return line.replace(/URI="([^"]+)"/g, (_, uri) => 'URI="' + mediaURL(new URL(uri, base).href) + '"');
}
function resolution(variant) {
  const w = Number(variant.width) || 0, h = Number(variant.height) || 0;
  if (w >= 3800 || h >= 2100) return 2160;
  if (w >= 1800 || h >= 1000) return 1080;
  if (w >= 1200 || h >= 700) return 720;
  if (w >= 800 || h >= 450) return 480;
  // Known SD dimensions are not adaptive/unknown. Include letterboxed rungs
  // so a 360-tier variant cannot bypass the existing global quality floor.
  if (w >= 600 || h >= 330) return 360;
  if (w >= 400 || h >= 230) return 240;
  return 0;
}
function validate(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT || !text.startsWith('#EXTM3U\n')) throw new PKError('BAD_PLAYLIST', 'Invalid bounded CineJoy master');
  const lines = text.trimEnd().split('\n'); let pending = false, variants = 0;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!/^(?:#EXT-X-(?:VERSION|MEDIA|STREAM-INF|SESSION-KEY):|#EXT-X-INDEPENDENT-SEGMENTS$)/.test(line) || /[\r\x00]/.test(line)) throw new PKError('BAD_PLAYLIST', 'Only master-playlist tags are supported');
      // Parse attributes as the player does, so an unquoted/duplicate URI cannot
      // smuggle a foreign origin past the text-only endpoint's CDN allowlist.
      for (const m of line.matchAll(/(?:[:,])\s*URI=("[^"\r\n]*"|[^,\r\n]*)/g)) mediaURL(m[1].startsWith('"') ? m[1].slice(1, -1) : m[1]);
      if (line.startsWith('#EXT-X-STREAM-INF:')) { if (pending) throw new PKError('BAD_PLAYLIST'); pending = true; }
    } else {
      if (!pending) throw new PKError('BAD_PLAYLIST', 'Media bytes/segments cannot use this route');
      mediaURL(line); pending = false; variants++;
    }
  }
  if (pending || variants !== 1) throw new PKError('BAD_PLAYLIST', 'Exactly one selected rendition is required');
  return text;
}
function encode(text) {
  validate(text);
  const token = zlib.deflateRawSync(Buffer.from(text)).toString('base64url');
  if (token.length > MAX_TOKEN) throw new PKError('BAD_PLAYLIST', 'CineJoy master exceeds portable URL limit');
  return token;
}
function decode(token) {
  if (!/^[A-Za-z0-9_-]{8,8000}$/.test(token)) throw new PKError('INVALID_INPUT', 'Invalid CineJoy master token');
  return validate(zlib.inflateRawSync(Buffer.from(token, 'base64url'), { maxOutputLength: MAX_TEXT }).toString('utf8'));
}
function selections(result, origin) {
  const { text = '', parsed, url } = result.manifest || {};
  const base = url || result.streams[0].playlist;
  const variants = parsed?.variants || [];
  if (!variants.length) {
    // A source-declared leaf URL is used verbatim, including its signed query.
    // Its explicit 1080p/720p/etc path is a declaration, not a measured-dimensions claim.
    const q = Number((new URL(base).pathname.match(/\/(2160|1080|720|480|360|240)p\.m3u8$/i) || [])[1]) || 0;
    return [{ url: mediaURL(base), quality: q, audio: [], dimensions: null, codecs: '' }];
  }
  const lines = text.split(/\r?\n/).map(s => s.trim()), output = [], seen = new Set();
  for (const variant of variants) {
    if (seen.has(variant.url)) continue;
    seen.add(variant.url);
    let inf = '', wanted = false;
    for (const line of lines) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) { inf = line; wanted = true; }
      else if (wanted && line && line[0] !== '#') {
        if (new URL(line, base).href === variant.url) break;
        inf = ''; wanted = false;
      }
    }
    if (!inf) throw new PKError('BAD_PLAYLIST', 'Selected rendition lost its original attributes');
    const attrs = attributes(inf), tags = [], audio = [];
    for (const line of lines) {
      if (/^#EXT-X-(?:VERSION:|INDEPENDENT-SEGMENTS\b|SESSION-KEY:)/.test(line)) tags.push(absolute(line, base));
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = attributes(line);
      if (!['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS', 'VIDEO'].includes(a.TYPE) || attrs[a.TYPE] !== a['GROUP-ID']) continue;
      tags.push(absolute(line, base));
      if (a.TYPE === 'AUDIO') audio.push(a.LANGUAGE || a.NAME || '');
    }
    const mini = '#EXTM3U\n' + tags.concat(inf, mediaURL(variant.url)).join('\n') + '\n';
    output.push({ url: origin.replace(/\/$/, '') + PREFIX + encode(mini) + '/master.m3u8', quality: resolution(variant), audio, dimensions: [variant.width, variant.height], codecs: variant.codecs || '' });
  }
  return output;
}
function serve(req, res, pathname) {
  if (!pathname.startsWith(PREFIX)) return false;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return true; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return true; }
  try {
    const m = pathname.match(/^\/cinejoy\/hls\/([A-Za-z0-9_-]{8,8000})\/master\.m3u8$/);
    if (!m) throw new PKError('INVALID_INPUT');
    const text = decode(m[1]);
    res.writeHead(200, { ...headers, 'content-type': 'application/vnd.apple.mpegurl', 'content-length': Buffer.byteLength(text), 'x-cinejoy-delivery': 'manifest-only; all CDN media direct' });
    res.end(req.method === 'HEAD' ? undefined : text);
  } catch (_) { res.writeHead(400, { ...headers, 'content-type': 'text/plain' }); res.end(req.method === 'HEAD' ? undefined : 'invalid CineJoy master'); }
  return true;
}
module.exports = { PREFIX, MAX_TEXT, mediaURL, resolution, encode, decode, selections, serve };
