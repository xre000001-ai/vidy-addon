'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {namedFunction}=require('./extract.cjs'),pins=require('./fixtures/vidy-stable-418.json'),root=path.resolve(__dirname,'../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex'),s=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('418 Vidy stable: all 58 provider/pool/card and related relay functions match the previously verified stable references',()=>{
 assert.equal(pins.stableReferences[0],'31028c6d24627ab6308179e4df6e9989e231d366');assert.equal(Object.keys(pins.functionHashes).length,58);
 for(const [name,h]of Object.entries(pins.functionHashes))assert.equal(hash(namedFunction(s,name)),h,name);
});
test('418 Vidy stable: 19 servers, Miami/Boise priority, proof freshness and original timing/cache settings were not rewritten',()=>{
 assert.equal(Object.keys(pins.criticalDeclarations).length,7);
 for(const [name,value]of Object.entries(pins.criticalDeclarations)){const m=s.match(new RegExp('^const '+name+' =[^\\n]*','m'));assert(m,name);assert.equal(m[0],value,name);}
});
test('418 Vidy stable: configure and existing tracked Vidy pool-data inputs are byte-identical to the stable baseline',()=>{
 for(const [file,h]of Object.entries(pins.stableFilesSHA256))assert.equal(hash(fs.readFileSync(path.join(root,file))),h,file);
});
test('418 Vidy stable: this entire server is unchanged from release 417 except for its release VERSION constant',()=>{
 const pattern=/const VERSION = '1\.34\.\d+';/g;assert.equal((s.match(pattern)||[]).length,1);
 const restored=require('../deadtoons-index/preservation.cjs').beforeDeadtoons('server.js').toString('utf8');
 const normalized=restored.replace(pattern,"const VERSION = '"+pins.normalizedServerVersion+"';");assert.equal(hash(normalized),pins.normalizedServerSHA256);
});
