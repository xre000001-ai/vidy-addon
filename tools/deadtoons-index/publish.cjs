'use strict';
// Two local commits, ONE non-force branch-ref push. The public manifest points
// to its immutable parent snapshot; mutable shard generations never get mixed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process'), C = require('./core.cjs');
async function publish({ repo, source, expected = '', push = false, env = process.env }) {
 const git = (...args) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
 let head = ''; try { head = git('rev-parse', 'HEAD'); } catch {}
 if (expected && head !== expected) throw Error('Data branch advanced after preparation; refusing stale publication');
 if (git('branch', '--show-current') !== C.DATA_BRANCH) throw Error('Refusing publication outside ' + C.DATA_BRANCH);
 if (git('status', '--porcelain')) throw Error('Data checkout must start clean');
 const cat = C.read(path.join(source, 'catalog.json'), null), status = C.read(path.join(source, 'status.json'), null);
 if (cat?.ver !== 4 || !Array.isArray(cat.shows) || typeof cat.complete !== 'boolean' || !status) throw Error('Missing aggregate catalog/status');
 const seenShows = new Set();
 for (const show of cat.shows) {
  if (!C.validSlug(show?.slug) || seenShows.has(show.slug) || !Array.isArray(show.seasons)) throw Error('Invalid catalog show'); seenShows.add(show.slug);
  if (cat.complete && show.complete !== true) throw Error('Unproven complete catalog show');
  const seenSeasons = new Set();
  for (const se of show.seasons) {
   if (seenSeasons.has(se.s)) throw Error('Duplicate catalog season'); seenSeasons.add(se.s);
   if (!Number.isInteger(se.s) || se.s < 0 || !Number.isInteger(se.n) || se.n < 0 || !Array.isArray(se.episodes) || se.episodes.some(e => !Number.isInteger(e) || e < 0)) throw Error('Invalid catalog episode inventory');
   if (cat.complete && (show.complete !== true || se.complete !== true || new Set(se.episodes).size !== se.n)) throw Error('Unproven complete catalog');
  }
 }
 const rows = C.load(source, C.SHARDS, { strict: true }), draft = C.read(path.join(source, 'dti/manifest.json'), null), actual = C.manifest(rows, cat);
 if (draft?.ver !== 4 || draft.shards !== C.SHARDS || draft.generation !== actual.generation) throw Error('Aggregate digest validation failed');
 for (const field of ['files', 'titles', 'n', 'units', 'hosts', 'slugs', 'catalog']) if (C.json(draft[field]) !== C.json(actual[field])) throw Error('Aggregate digest/coverage mismatch: ' + field);
 if (C.json(draft.run) !== C.json(status)) throw Error('Aggregate status mismatch');
 for (let i = 0; i < C.SHARDS; i++) {
  const file = C.filename(i), raw = fs.readFileSync(path.join(source, 'dti', file));
  if (C.digest(raw) !== draft.files[file]) throw Error('Shard digest mismatch: ' + file);
  const states = C.read(path.join(source, 'state', file), null);
  if (!states || typeof states !== 'object' || Array.isArray(states)) throw Error('Missing/invalid persistent state');
  for (const [key, value] of Object.entries(states)) {
   const [slug, s, e, extra] = key.split('|');
   if (!C.validSlug(slug) || !/^\d+$/.test(s || '') || !/^\d+$/.test(e || '') || extra !== undefined || C.shard(slug) !== i || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid persistent state ownership');
  }
 }
 const copy = relative => { const to = path.join(repo, relative); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(source, relative), to); };
 for (let i = 0; i < C.SHARDS; i++) { copy('dti/' + C.filename(i)); copy('state/' + C.filename(i)); } copy('catalog.json'); copy('status.json');
 git('add', '--', 'dti', 'state', 'catalog.json', 'status.json');
 const commit = message => git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=deadtoons-index[bot]', '-c', 'user.email=deadtoons-index@users.noreply.github.com', 'commit', '-m', message);
 if (git('diff', '--cached', '--name-only')) commit('DeadToons index: validated snapshot');
 const snapshot = git('rev-parse', 'HEAD'), manifest = C.manifest(rows, cat, { want: 2, ref: snapshot, run: status }); C.write(path.join(repo, 'dti/manifest.json'), manifest);
 git('add', '--', 'dti/manifest.json'); if (git('diff', '--cached', '--name-only')) commit('DeadToons index: atomic generation ' + manifest.generation.slice(0, 12));
 const publishedCommit = git('rev-parse', 'HEAD');
 if (push) {
  const pushEnv = { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' }; let temp;
  try {
   if (env.GH_TOKEN) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-git-auth-')); const ask = path.join(temp, 'askpass');
    fs.writeFileSync(ask, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$GH_TOKEN" ;; esac\n', { mode: 0o700 }); pushEnv.GIT_ASKPASS = ask;
   }
   cp.execFileSync('git', ['-c', 'credential.helper=', 'push', 'origin', 'HEAD:refs/heads/' + C.DATA_BRANCH], { cwd: repo, encoding: 'utf8', env: pushEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
   const remote = cp.execFileSync('git', ['-c', 'credential.helper=', 'ls-remote', 'origin', 'refs/heads/' + C.DATA_BRANCH], { cwd: repo, encoding: 'utf8', env: pushEnv, timeout: 30000 }).split(/\s+/)[0];
   if (remote !== publishedCommit) throw Error('Published data ref could not be verified');
  } finally { if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
 }
 const result = { published: push, branch: C.DATA_BRANCH, commit: publishedCommit, snapshot, generation: manifest.generation, n: manifest.n, units: manifest.units, catalog: manifest.catalog };
 console.log(JSON.stringify(result)); return result;
}
module.exports = { publish };
