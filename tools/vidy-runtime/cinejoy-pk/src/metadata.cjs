'use strict';
const { PKError } = require('./errors.cjs');
function requestIdentity(type, id, season, episode) {
  if (!['movie', 'tv', 'series'].includes(type)) throw new PKError('INVALID_INPUT', 'Invalid CineJoy media type');
  const tv = type !== 'movie', value = String(id);
  if (!/^(?:tt\d{5,12}|(?:tmdb)?\d{1,10})$/.test(value)) throw new PKError('INVALID_INPUT', 'CineJoy requires an IMDb or TMDB id');
  const s = tv ? Number(season == null ? 1 : season) : 0, e = tv ? Number(episode == null ? 1 : episode) : 0;
  if (tv && (!Number.isInteger(s) || s < 0 || s > 9999 || !Number.isInteger(e) || e < 1 || e > 99999)) throw new PKError('INVALID_INPUT', 'Invalid CineJoy season/episode');
  return { type: tv ? 'tv' : 'movie', id: value, season: s, episode: e, key: [tv ? 'tv' : 'movie', value, s, e].join(':') };
}
function bounded(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason || new PKError('ABORTED')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
  });
}
class Metadata {
  constructor(getJSON) { this.getJSON = getJSON; this.cache = new Map(); this.pending = new Map(); }
  async load(identity, signal) {
    const { type, id } = identity, key = type + ':' + id;
    let item = this.cache.get(key);
    if (!item || item.expires <= Date.now()) {
      let work = this.pending.get(key);
      if (!work) {
        work = this.fetch(type, id).then(v => {
          this.cache.set(key, { value: v, expires: Date.now() + 86400000 });
          while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
          return v;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, work);
      }
      item = { value: await bounded(work, signal) };
    }
    return { ...item.value, ...(type === 'tv' ? { season: String(identity.season), episode: String(identity.episode) } : {}) };
  }
  async fetch(type, id) {
    if (typeof this.getJSON !== 'function') throw new PKError('LOCAL_METADATA', 'CineJoy metadata lookup is not configured');
    const imdb = /^tt/.test(id) ? id : '';
    let data;
    if (imdb) {
      const found = await this.getJSON('/find/' + imdb + '?external_source=imdb_id');
      const matches = type === 'tv' ? found?.tv_results : found?.movie_results;
      if (!Array.isArray(matches) || matches.length !== 1) throw new PKError('NO_STREAM', 'No unique IMDb-to-TMDB identity');
      data = matches[0];
    } else {
      data = await this.getJSON('/' + type + '/' + id.replace(/^tmdb/, '') + '?append_to_response=external_ids');
      if (String(data?.id) !== id.replace(/^tmdb/, '').replace(/^0+/, '')) throw new PKError('BAD_RESPONSE', 'TMDB metadata identity mismatch');
    }
    if (!/^\d{1,10}$/.test(String(data?.id))) throw new PKError('BAD_RESPONSE', 'CineJoy metadata has no valid TMDB id');
    const title = String(data.title || data.name || '').replace(/[\r\n\x00]/g, ' ').trim();
    if (!title || title.length > 300) throw new PKError('BAD_RESPONSE', 'CineJoy metadata has no valid title');
    const year = String(data.release_date || data.first_air_date || '').slice(0, 4);
    const external = imdb || data.imdb_id || data.external_ids?.imdb_id || '';
    return { type, tmdb: String(data.id), imdb: /^tt\d{5,12}$/.test(external) ? external : '', title, year: /^\d{4}$/.test(year) ? year : '' };
  }
}
module.exports = { Metadata, requestIdentity, bounded };
