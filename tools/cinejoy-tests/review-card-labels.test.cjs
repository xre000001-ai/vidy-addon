'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {cardsFor}=require('../vidy-runtime/cinejoy.cjs'),m=require('../vidy-runtime/cinejoy-pk/src/manifests.cjs');
const {result,sample,parse,base}=require('./addon-helpers.cjs');
const origin='https://addon.example';
function noAudioMaster(dimensions='640x360'){
 const r=result('Nebula'),text='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION='+dimensions+',CODECS="avc1.64001e,mp4a.40.2"\n360p.m3u8?sig=a%2Fb\n';
 r.manifest={url:base,text,parsed:parse(text,base)};return r;
}
test('review: an explicitly declared 640x360 rendition is 360, never Auto',()=>{
 const r=noAudioMaster(),c=cardsFor(r,sample,origin,{})[0];assert.equal(c.quality,'360');assert.equal(c.name,'▥ 360 ▥');assert.equal(m.decode(c.url.split('/').at(-2)),r.manifest.text.replace('360p.m3u8?sig=a%2Fb',new URL('360p.m3u8?sig=a%2Fb',base).href));
});
test('review: letterboxed 360-tier declarations cannot escape as unknown-quality Auto cards',()=>{
 assert.equal(m.resolution({width:640,height:268}),360);assert.equal(m.resolution({width:640,height:272}),360);assert.equal(m.resolution({}),0);
});
test('review: a signed source-declared 360p leaf stays byte-exact and is not mislabeled Auto',()=>{
 const r=result('Polaris'),url='https://erebus.cursed.st/playlists/movie/27205/360p.m3u8?token=a%2Fb';r.manifest={url,parsed:{variants:[]}};const c=cardsFor(r,sample,origin,{})[0];assert.equal(c.name,'▥ 360 ▥');assert.equal(c.url,url);assert.equal(cardsFor(r,sample,origin,{cjq:[1080]}).length,0);
});
test('review: muxed/default audio uses Original Audio, not a fake adaptive-audio label',()=>{
 const c=cardsFor(noAudioMaster(),sample,origin,{})[0];assert.match(c.title,/⌗ Original Audio • Nebula$/);assert(!c.title.includes('Auto Audio'));
});
test('review: actual HLS language metadata always outranks the original-audio fallback',()=>{
 const r=result('Light');const c=cardsFor(r,{...sample,original_language:'hi'},origin,{})[0];assert.match(c.title,/⌗ English • Light$/);const plain=noAudioMaster();plain.streams[0].captions=[{type:'vtt',language:'hi',url:'https://subs2.wing.st/hindi.vtt'}];assert.match(cardsFor(plain,sample,origin,{})[0].title,/⌗ Original Audio • Nebula$/);
});
test('review: selected audio groups, track order and default/autoselect flags are not changed by relabeling',()=>{
 const r=result(),c=cardsFor(r,sample,origin,{})[0],text=m.decode(c.url.split('/').at(-2));assert(text.includes('LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES'));assert(text.includes('AUDIO="a",SUBTITLES="s"'));assert.equal(c.behaviorHints.proxyHeaders.request.Referer,'https://cinejoy.pk/');
});
test('review: the existing sub-720 floor still recognizes 360 after final formatting, without changing other sources',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8'),a=s.indexOf('const FMT_JUNK ='),b=s.indexOf('const YEAR_CACHE =',a),ctx={console,process:{env:{}},URL,Map,Set,Buffer};vm.runInNewContext(s.slice(a,b)+';globalThis.f=fmtCards;globalThis.s=stripCards;',ctx);
 const cards=cardsFor(noAudioMaster(),sample,origin,{});ctx.f(cards);const c=ctx.s(cards)[0];assert.equal(c.name,'▥ 360 ▥');assert.match(c.title,/Original Audio/);assert.equal(Number(c.name.match(/\d+/)[0]),360);
 assert(s.includes('q > 0 && q < 720'));assert(s.includes("Number(process.env.SCUT || 8600)"));
});
