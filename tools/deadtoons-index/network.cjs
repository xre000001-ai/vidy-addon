'use strict';
// Only the public metadata/gate API. This module never visits final media URLs.
const API = 'https://api.deadbase.host/api/v1/public';
class UpstreamError extends Error {
 constructor(message, { status = 0, retryAt = 0, transient = true } = {}) { super(message); Object.assign(this, { status, retryAt, transient }); }
}
function create({ fetch: fetcher = fetch, now = Date.now, sleep, deadline = Infinity, signal, timeout = 16000 } = {}) {
 let coolUntil = 0, nextStart = 0;
 const stats = { requests: 0, limited: 0, transient: 0, gateWaitMs: 0 }, left = () => Math.max(0, deadline - now());
 async function wait(ms) {
  if (signal?.aborted || ms >= left()) throw new UpstreamError('Budget exhausted before upstream wait', { retryAt: now() + ms });
  if (ms > 0) {
   if (sleep) await sleep(ms);
   else await new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms), abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new UpstreamError('Background job aborted')); };
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
   });
  }
  if (signal?.aborted || left() <= 0) throw new UpstreamError('Budget exhausted');
 }
 async function acquire() {
  for (;;) {
   const at = Math.max(now(), coolUntil, nextStart); nextStart = at + 100; await wait(Math.max(0, at - now()));
   if (coolUntil <= now()) return;
  }
 }
 async function request(p, body, attempts = 2) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('://') || !Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw Error('Invalid DeadToons API path/retry count');
  for (let attempt = 0; attempt < attempts; attempt++) {
   if (signal?.aborted || left() < 100) throw new UpstreamError('Budget exhausted');
   await acquire(); let response;
   try {
    stats.requests++;
    response = await fetcher(API + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'User-Agent': 'Mozilla/5.0 Vidy-DeadToons-Index/4', Accept: 'application/json', Referer: 'https://deadtoons.sbs/', Origin: 'https://deadtoons.sbs', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(timeout, left())))]) : AbortSignal.timeout(Math.max(1, Math.min(timeout, left()))) });
   } catch (e) {
    stats.transient++; if (signal?.aborted) throw new UpstreamError('Background job aborted');
    if (attempt + 1 < attempts) { await wait(1000 * (attempt + 1)); continue; }
    throw new UpstreamError('Network/timeout: ' + (e.code || e.name));
   }
   if (response.ok) { try { return await response.json(); } catch { throw new UpstreamError('Invalid upstream JSON'); } }
   const status = response.status, ra = response.headers?.get('retry-after'); let delay = Number(ra) * 1000;
   if (!Number.isFinite(delay) || delay <= 0) delay = ra ? Date.parse(ra) - now() : 0;
   try { await response.body?.cancel(); } catch {}
   if (status === 429 || status >= 500) {
    delay = Math.max(status === 429 ? 30000 : 2000, Number.isFinite(delay) ? delay : 0); coolUntil = Math.max(coolUntil, now() + delay); stats.transient++; if (status === 429) stats.limited++;
    if (attempt + 1 < attempts && delay + 200 < left()) { await wait(delay); continue; }
    throw new UpstreamError('Upstream ' + status, { status, retryAt: coolUntil });
   }
   throw new UpstreamError('Upstream ' + status, { status, transient: ![404, 410].includes(status) });
  }
 }
 async function unlock(id) {
  // Never blindly retry start: a lost response is not permission for a new gate.
  const start = await request('/unlock/' + encodeURIComponent(id) + '/start', { shortener_id: 7 }, 1);
  let token;
  try { const u = new URL(start?.redirect_url); if (!['http:', 'https:'].includes(u.protocol)) throw Error(); token = u.pathname.replace(/\/+$/, '').split('/').pop(); } catch { throw new UpstreamError('Missing/invalid gate redirect'); }
  if (!/^[A-Za-z0-9._~-]+$/.test(token || '')) throw new UpstreamError('Invalid gate token');
  let gate = await request('/own-shortener/gate/' + token, {}, 1);
  for (let attempt = 0; gate?.done !== true && attempt < 4; attempt++) {
   if (!gate || typeof gate !== 'object') throw new UpstreamError('Missing gate state');
   const seconds = Number(gate.remaining_seconds ?? gate.wait_seconds ?? 15);
   if (!Number.isFinite(seconds) || seconds < 0) throw new UpstreamError('Invalid gate wait');
   const ms = Math.max(0, seconds * 1000) + 400; stats.gateWaitMs += ms; await wait(ms);
   try { gate = await request('/own-shortener/gate/' + token + '/continue', {}, 1); }
   catch (e) { if (e.status !== 409) throw e; gate = await request('/own-shortener/gate/' + token, {}, 1); }
  }
  if (gate?.done !== true) throw new UpstreamError('Gate is not complete');
  const callback = await request('/unlock/callback/' + token, {}, 1), url = callback?.url || callback?.final_url || callback?.redirect_url;
  if (!url) throw new UpstreamError('Missing final advertised link'); return String(url);
 }
 return { request, unlock, stats, left };
}
module.exports = { API, UpstreamError, create };
