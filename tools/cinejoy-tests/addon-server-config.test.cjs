'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8'),start=src.indexOf('function qToList('),end=src.indexOf('\nfunction decodeCfg(',start),ctx={SERVERS:['miami','boise'],QH:[2160,1080,720,480,360]};
vm.runInNewContext(src.slice(start,end)+';globalThis.parse=parseCfgFromObj;',ctx);
const normal=x=>JSON.parse(JSON.stringify(x));
test('real addon parser accepts CineJoy switch, exact quality arrays and own server exclusions',()=>{const c=normal(ctx.parse({cj:'0',cjq:[1080,2160,1080,999,360],cjsrv:['LIGHT','light','evil','polaris']}));assert.equal(c.cj,0);assert.deepEqual(c.cjq,[1080,2160]);assert.deepEqual(c.cjsrv,['light','polaris']);assert.equal(c.v,1);assert.equal(c.nx,1);assert.equal(c.hm,1);});
test('CineJoy quality selections never rewrite global, MovieBox or HindMovie filter values',()=>{const c=normal(ctx.parse({cjq:[1080],q:[720],nxq:[2160],hmq:[480]}));assert.deepEqual(c.cjq,[1080]);assert.deepEqual(c.q,[720]);assert.deepEqual(c.nxq,[2160]);assert.deepEqual(c.hmq,[480]);});
test('an old configuration gains no new default keys or manifest-id churn from CineJoy defaults',()=>{const c=normal(ctx.parse({nx:0,hmq:[1080],hml:['hindi']}));assert(!('cj'in c)&&!('cjq'in c)&&!('cjsrv'in c));assert.equal(c.nx,0);assert.deepEqual(c.hmq,[1080]);assert.deepEqual(c.hml,['hindi']);});
test('query-string comma resolution sets use existing parser semantics and do not become threshold caps',()=>{const c=normal(ctx.parse({cjq:'2160,1080',cjsrv:['nebula']}));assert.deepEqual(c.cjq,[2160,1080]);assert.deepEqual(c.cjsrv,['nebula']);assert.equal(c.srv.length,0);assert.equal(c.rtsrv.length,0);});
