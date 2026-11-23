'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { beforeCardText } = require('./preservation.cjs');
const { beforeSourceReview } = require('../source-review-tests/preservation.cjs');
const baseline = require('./fixtures/baseline-sha256.json');
const edits = require('./fixtures/authorized-edits.json');
const root = path.resolve(__dirname, '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const scope = new Set(['server.js', 'tools/cinejoy-tests/stability-preservation.cjs', 'tools/cinejoy-tests/stability-preservation.test.cjs']);

test('card-text preservation: only the server display hunks and the exact older-check inverse chain are authorized', () => {
  assert.equal(baseline.head, '37d37b5702f9af774a28ef34f64cd7057edc2914');
  assert.equal(Object.keys(baseline.sha256).length, 312);
  assert.deepEqual(new Set(edits.map(e => e.file)), scope);
  assert.equal(edits.length, 10);
  for (const e of edits) {
    assert(e.reason); assert.equal(e.count, 1); assert(e.old && e.new && e.old !== e.new);
  }
});

test('card-text preservation: all 312 previously tracked files reconstruct the exact deployed baseline without hash resets', () => {
  for (const [file, expected] of Object.entries(baseline.sha256))
    assert.equal(hash(beforeCardText(file)), expected, 'Unapproved card-text delta: ' + file);
});

test('card-text preservation: the other 309 files, including providers, extraction, pools, media delivery, settings and dependencies, are literally unchanged', () => {
  for (const [file, expected] of Object.entries(baseline.sha256)) {
    if (scope.has(file)) continue;
    assert.equal(hash(beforeSourceReview(file)), expected, file);
  }
  for (const file of ['config.html', 'package.json', 'package-lock.json', 'nexa.js', 'nexa-cap.js',
    'tools/vidy-runtime/cinejoy.cjs', 'tools/vidy-runtime/hindmovie.cjs',
    'tools/vidy-runtime/cinejoy-pk/src/pool.cjs', 'tools/vidy-runtime/cinejoy-pk/src/refill.cjs',
    'tools/vidy-runtime/cinejoy-pk/src/engine.cjs', 'tools/vidy-runtime/cinejoy-pk/src/transport.cjs',
    'tools/vidy-runtime/cinejoy-pk/src/manifests.cjs']) assert(!scope.has(file));
});

test('card-text preservation: every old server byte outside the seven exact display hunks remains identical', () => {
  const serverEdits = edits.filter(e => e.file === 'server.js');
  assert.equal(serverEdits.length, 7);
  assert.equal(hash(beforeCardText('server.js')), baseline.sha256['server.js']);
  const now = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const old = beforeCardText('server.js').toString('utf8');
  for (const marker of ["if (process.env.NEXA_LOCAL === '1')", "Number(process.env.NEXA_ADDON_TMO || 9000)",
    "const SDL_MS = Number(process.env.SDL || 12000)", "Number(process.env.SCUT || 8600)",
    "const VRC_TTL = 0;", "q > 0 && q < 720", "function gwStamp(", "async function withSources("]) {
    assert(now.includes(marker), marker); assert(old.includes(marker), marker);
  }
  const removed = serverEdits.find(e => e.reason.startsWith('Remove only'));
  assert(removed.old.includes("('v' + i2)"));
  assert(!removed.new.includes('filter(')); assert(!removed.new.includes('splice('));
});
