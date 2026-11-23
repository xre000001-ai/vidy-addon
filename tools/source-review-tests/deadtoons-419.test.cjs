'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),{beforeDeadtoons}=require('../deadtoons-index/preservation.cjs'),pins=require('../deadtoons-index/fixtures/baseline-418-sha256.json'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('419 DT-only preservation: all337 released418 file hashes reconstruct exactly, without baseline resets/exemptions',()=>{
 a.equal(Object.keys(pins).length,337);for(const[f,h]of Object.entries(pins))a.equal(hash(beforeDeadtoons(f)),h,f);
});
test('419 DT-only preservation: all non-DT server bytes remain identical to right-now418',()=>{
 const original=beforeDeadtoons('server.js').toString('utf8'),current=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const mask=s=>{const begin=s.indexOf('const DT_API = '),end=s.indexOf('// ---------- ToonWorld + RareToons',begin);a(begin>0&&end>begin);return (s.slice(0,begin)+'DT_PROVIDER_ONLY\n'+s.slice(end)).replace(/const VERSION = '1\.34\.\d+';/,"const VERSION = 'release';");};
 a.equal(mask(current),mask(original),'No non-DT provider, header, subtitle, audio, shared relay/cache/scheduler/budget/function may change.');
});
test('419 DT automation: shared catalog, consistent snapshot inputs, bounded four-slice work and one data-only publisher',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/dt-index.yml'),'utf8'),publisher=fs.readFileSync(path.join(root,'tools/deadtoons-index/publish.cjs'),'utf8');
 for(const text of ['schedule:','push:','workflow_dispatch:','ref: deadtoons-index','needs.prepare.outputs.data_sha','name: dt-plan','pattern: dt-slice-*','--want=2 --concurrency=6','--slices=4','cli.cjs publish','cancel-in-progress: false'])a(workflow.includes(text),text);
 a(!workflow.includes('--publish'));a(!publisher.includes('HEAD:main'));a(!publisher.includes('--force'));a(publisher.includes("HEAD:refs/heads/"));a(workflow.includes('GH_TOKEN:'));
});
test('419 DT-only valid old data and both mirrors survive normalization, with truthful coverage',()=>{
 const C=require('../deadtoons-index/core.cjs'),rows=C.load(root),m=C.manifest(rows,{complete:false,shows:[]});a.equal(m.n,15810);a.equal(m.units.indexed,9070);a.equal(m.units.total,null);a.equal(m.slugs.length,1408);a(Object.values(rows).flat().some(r=>r[2]===0));a(Object.values(rows).flat().some(r=>r[2]===1));
});
require('../deadtoons-index/index.test.cjs');
require('../deadtoons-index/regression.test.cjs');
require('../deadtoons-index/addon.test.cjs');
require('../deadtoons-index/pipeline.test.cjs');
test('419 DT resolution preservation: media/link resolver, identity/episode/card/header/audio policies were not rewritten',()=>{
 const {namedFunction}=require('./extract.cjs'),old=beforeDeadtoons('server.js').toString('utf8'),current=fs.readFileSync(path.join(root,'server.js'),'utf8');
 for(const name of ['dtFileProof','dtDlCands','dtRowsToLinks','dtTitleOk','dtAudio','dtEmbedHls','dtUnpackJs','dtJson','dtJsonPost'])a.equal(namedFunction(current,name),namedFunction(old,name),name);
});
