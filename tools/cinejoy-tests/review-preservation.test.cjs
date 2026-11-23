'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {beforeReview}=require('./review-preservation.cjs'),baseline=require('./fixtures/careful-review-baseline-sha256.json'),edits=require('./fixtures/careful-review-authorized-edits.json');
const root=path.resolve(__dirname,'../..'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const scope=new Set(['config.html','server.js','tools/vidy-runtime/hindmovie.cjs','tools/vidy-runtime/cinejoy.cjs','tools/vidy-runtime/cinejoy-pk/src/manifests.cjs','tools/vidy-runtime/cinejoy-pk/src/transport.cjs','tools/vidy-runtime/cinejoy-pk/README.md','tools/cinejoy-tests/addon-preservation.test.cjs']);
test('review preservation: exact authorized scope is bounded, with no dependencies, foreign pools or unrelated provider changes',()=>{
 assert.equal(baseline.head,'07d669ff6fae90669fdfd232f046b571dd65f1e1');assert.equal(Object.keys(baseline.sha256).length,297);
 assert.deepEqual(new Set(edits.map(e=>e.file)),scope);for(const e of edits){assert(e.reason);assert.equal(e.count,1);assert(e.old&&e.new);assert(e.old!==e.new);}
});
test('review preservation: inherited upstream bot changes are exactly pinned DT index data, not silent source edits',()=>{
 const upstream=require('./fixtures/careful-review-upstream-index.json');assert.equal(upstream.base,baseline.head);assert.equal(upstream.upstreamCommit,'031cc79db61937dfd2e9a88c5c2c690f59d7ce12');assert.equal(Object.keys(upstream.files).length,12);
 for(const [file,item] of Object.entries(upstream.files)){assert.match(file,/^dti\/(?:manifest|s\d{2})\.json$/);assert.equal(hash(fs.readFileSync(path.join(root,file))),item.afterSha256,file);assert.equal(item.beforeSha256,baseline.sha256[file],file);assert.equal(hash(beforeReview(file)),baseline.sha256[file],file);}
});
test('review preservation: all 297 pre-review tracked files reconstruct the deployed baseline with exact inverse anchors',()=>{
 for(const [file,expected] of Object.entries(baseline.sha256))assert.equal(hash(beforeReview(file)),expected,'Unapproved review delta: '+file);
});
test('review preservation: all unrelated runtime, proxy-pool and dependency bytes remain literally unchanged',()=>{
 for(const [file,expected] of Object.entries(baseline.sha256)){
  if(!/^(?:tools\/vidy-runtime\/|.*pool.*\.(?:json|txt)$|package(?:-lock)?\.json$)/.test(file)||scope.has(file))continue;
  assert.equal(hash(fs.readFileSync(path.join(root,file))),expected,file);
 }
});
