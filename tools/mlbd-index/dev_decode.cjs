// Local-only helper: decode a MovieLinkBD movie page's download tokens so the
// file page and its nested mirror page can be inspected directly.
const { execFileSync } = require('child_process');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
function get(u, ref) {
  return execFileSync('curl', ['-g', '-s', '-k', '-L', '-m', '25', '-A', UA, '-e', ref || 'https://movielinkbd.com/', u], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}
function mlbdDec(b64, seedHex, rounds) {
  let x = parseInt(seedHex, 16) >>> 0;
  for (let i = 0; i < (rounds | 0); i++) x = (Math.imul(x, 1103515245) + 12345) >>> 0;
  const raw = Buffer.from(String(b64 || ''), 'base64');
  const out = Buffer.alloc(raw.length);
  for (let j = 0; j < raw.length; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out[j] = raw[j] ^ ((x >>> 16) & 255); }
  return out.toString('utf8');
}
const post = process.argv[2];
const html = get(post);
const out = [];
const re = /<a\b[^>]*?data-dl="([^"]*)"[^>]*>/g;
let m;
while ((m = re.exec(html))) {
  const tag = m[0];
  const ds = (tag.match(/data-ds="([^"]*)"/) || [])[1] || '';
  const dr = parseInt((tag.match(/data-dr="(\d+)"/) || [])[1], 10) || 0;
  let t = '';
  try { t = mlbdDec(m[1], ds, dr); } catch (e) { continue; }
  const rest = html.slice(re.lastIndex, re.lastIndex + 520);
  const stop = rest.search(/data-dl=|<\/a>/);
  const win = stop >= 0 ? rest.slice(0, stop) : rest;
  const lab = ((win.match(/\[([^\]]{2,80})\]/) || [])[1] || '').trim();
  out.push({ t, lab });
}
console.log(JSON.stringify(out, null, 1));
