import { fetch as ufetch, ProxyAgent } from 'undici';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const ag = new ProxyAgent('http://190.12.150.244:999');
async function get(u, ms = 16000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 30), body: '' }; }
}
const titles = [['315162','Puss in Boots 2','2022'],['299534','Avengers Endgame','2019'],['324857','Spider-Verse','2018'],['49026','Dark Knight Rises','2012'],['671','Harry Potter 1','2001'],['24428','Avengers','2012'],['361743','Top Gun Maverick','2022'],['872585','Oppenheimer','2023'],['1399','GoT(tv)','2011'],['60625','Rick and Morty(tv)','2013']];
for (const [id, name, yr] of titles) {
  const s = await get(API + '/seed?mediaId=' + id, 8000);
  let seed = ''; try { seed = JSON.parse(s.body).seed || ''; } catch (e) {}
  if (!seed) { console.log(id, name, 'SEED-FAIL'); continue; }
  const tv = name.includes('(tv)');
  const q = { title: name.replace('(tv)', ''), mediaType: tv ? 'tv' : 'movie', year: yr, tmdbId: id, enc: '2', seed };
  if (tv) { q.season = '1'; q.episode = '1'; }
  const r = await get(API + '/atlanta/sources?' + new URLSearchParams(q));
  let msg = ''; try { msg = JSON.parse(r.body).message || ('len=' + r.body.length); } catch (e) { msg = 'len=' + r.body.length; }
  console.log(id.padEnd(7), name.padEnd(20), 'st=' + r.st, r.ms + 'ms', msg);
}
