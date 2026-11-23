'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {beforeStability}=require('./stability-preservation.cjs'),baseline=require('./fixtures/stability-baseline-sha256.json'),edits=require('./fixtures/stability-authorized-edits.json');
const root=path.resolve(__dirname,'../..'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const scope=new Set(['tools/vidy-runtime/cinejoy.cjs','tools/vidy-runtime/cinejoy-pk/src/pool.cjs','tools/vidy-runtime/cinejoy-pk/src/refill.cjs','tools/cinejoy-tests/review-preservation.cjs','tools/cinejoy-tests/review-preservation.test.cjs']);
test('stability preservation: exact approved scope is CineJoy scheduling, scoped cooldown, and chained preservation checks only',()=>{
 assert.equal(baseline.head,'4d92bf87bfaa7d5184e61822bc84b121ba9f4d23');assert.equal(Object.keys(baseline.sha256).length,306);assert.deepEqual(new Set(edits.map(e=>e.file)),scope);for(const e of edits){assert(e.reason);assert.equal(e.count,1);assert(e.old&&e.new&&e.old!==e.new);}
});
test('stability preservation: all 306 pre-audit tracked files reconstruct exact deployed bytes without excluding any file',()=>{
 for(const [file,expected] of Object.entries(baseline.sha256))assert.equal(hash(beforeStability(file)),expected,'Unapproved stability delta: '+file);
});
test('stability preservation: server, HM, all unrelated providers, settings, media delivery and dependencies remain literally byte-identical',()=>{
 for(const [file,expected] of Object.entries(baseline.sha256)){if(scope.has(file))continue;assert.equal(hash(fs.readFileSync(path.join(root,file))),expected,file);}
 for(const file of ['server.js','config.html','tools/vidy-runtime/hindmovie.cjs','tools/vidy-runtime/cinejoy-pk/src/engine.cjs','tools/vidy-runtime/cinejoy-pk/src/transport.cjs','tools/vidy-runtime/cinejoy-pk/src/manifests.cjs','tools/vidy-runtime/cinejoy-pk/src/hls.cjs','package.json','package-lock.json'])assert(!scope.has(file));
});
