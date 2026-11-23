'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),hm=require('../vidy-runtime/hindmovie.cjs');
const post='https://v5.hindmovie.im/example-2020-hindi-1080p/',embed='https://mvlink.blog/1234',file='Example.2020.1080p.mkv',hub=n=>'https://hub.workers.dev/0:/'+n,source=n=>'https://hshare.lol/?id='+encodeURIComponent(n);
const reply=t=>({st:200,t});
function delayed(t,ms,signal){return new Promise(resolve=>{let done=false,timer;const finish=abort=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve(abort?{st:0,t:''}:reply(t));},cancel=()=>finish(true);if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>finish(false),ms);});}
// Keep enough headroom for the released resolver's existing 100ms admission
// guard; these synthetic clocks must exercise overlap, not that safety floor.
function fixture({htmlDelay=700,restDelay=5,names=[file],restNames=names,htmlNames=names,htmlFailure=false,slowFast=false,wrongImdb=false,embedURL=embed}={}){
 const calls=[],signals=[];let active=0,max=0;
 const links=ns=>ns.map(n=>'<a href="'+source(n)+'">File</a>').join('');
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  assert(!url.includes('.workers.dev'),'No media probing');calls.push({url,ms,body,signal});
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:post}]));
  if(url.includes('/?s='))return reply('');
  if(url===post)return reply('<a href="https://imdb.com/title/'+(wrongImdb?'tt7654321':'tt1234567')+'">IMDb</a><h3>1080p</h3><a href="'+embedURL+'">Links</a>');
  if(url===embedURL||url.includes('mvlink.blog/wp-json/wp/v2/posts/')){
   active++;max=Math.max(max,active);signals.push(signal);
   try{const rest=url.includes('/wp-json/'),r=await delayed(rest?JSON.stringify({content:{rendered:links(restNames)}}):links(htmlNames),rest?restDelay:htmlDelay,signal);return !rest&&htmlFailure?{st:0,t:''}:r;}finally{active--;}
  }
  if(url.includes('hshare.lol'))return delayed('<a href="'+hub(new URL(url).searchParams.get('id'))+'">Hub</a><a href="https://gdshine.org/s/abcdefghi">Fast</a>',15,signal);
  if(url.includes('/api/share/'))return delayed('{"data":{"file":{"id":"file-id"}}}',5,signal);
  if(url.includes('/via-worker'))return delayed('{"data":{"copyUrl":"https://fast.workers.dev/d/ready"}}',slowFast?10000:5,signal);
  throw Error('Unexpected fixture network: '+url);
 }});
 return {h,calls,signals,max:()=>max,setHTMLDelay:ms=>{htmlDelay=ms;}};
}
test('418 HM: REST-first file work supplies ready mirrors on the same tap while canonical HTML remains pending',async()=>{
 const f=fixture(),began=Date.now(),out=await f.h.cards('Example','movie',0,0,null,400,{imdb:'tt1234567'});
 assert.equal(out.length,2);assert.equal(out.$pend,true);assert(Date.now()-began<650);assert(f.h.last().firstCardMs<200);assert(f.calls.some(c=>c.url.endsWith('/posts/1234')));assert(f.signals.some(s=>s.aborted));
});
test('418 HM: a fast complete HTML page avoids unnecessary REST traffic',async()=>{
 const f=fixture({htmlDelay:1}),out=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567'});assert.equal(out.length,2);assert(!f.calls.some(c=>c.url.includes('mvlink.blog/wp-json/')));
});
test('418 HM: progressive REST discovery retains all requested files and drops neither 1080p nor 4K',async()=>{
 const names=['Example.A.1080p.mkv','Example.B.2160p.mkv','Example.C.720p.mkv'];const f=fixture({names}),out=await f.h.cards('Example','movie',0,0,null,200,{imdb:'tt1234567'});
 assert.equal(new Set(out.map(c=>c.filename)).size,2);assert.deepEqual([...new Set(out.map(c=>c.quality))].sort(),['1080','2160']);assert(out.some(c=>c.filename.includes('.A.'))&&out.some(c=>c.filename.includes('.B.')));assert(!out.some(c=>c.filename.includes('.C.')));assert.equal(out.$pend,true);
});
test('418 HM: a wrong-title fast REST representation cannot beat correct slower HTML',async()=>{
 const f=fixture({htmlDelay:100,restNames:['Different.Movie.1080p.mkv']}),out=await f.h.cards('Example','movie',0,0,null,350,{imdb:'tt1234567'});assert.equal(out.length,2);assert(out.every(c=>c.filename===file));assert(!f.calls.some(c=>c.url.includes('id=Different')));
});
test('418 HM: a filename-only HTML shell cannot beat a complete REST file list',async()=>{
 const f=fixture({htmlDelay:1,htmlNames:[]}),out=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567'});assert.equal(out.length,2);assert(f.calls.some(c=>c.url.endsWith('/posts/1234')));
});
test('418 HM: an already ready Hub remains visible if the Fast link API misses the unchanged absolute deadline',async()=>{
 const f=fixture({slowFast:true}),began=Date.now(),out=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567',deadline:began+300});assert.equal(out.length,1);assert.equal(out[0].url,hub(file));assert.equal(out.$pend,true);assert(Date.now()-began<600);assert(f.calls.every(c=>c.ms>0&&c.ms<=300));
});
test('418 HM: a confirmed wrong post identity prevents either embed representation or final mirror extraction',async()=>{
 const f=fixture({wrongImdb:true}),out=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567'});assert.equal(out.length,0);assert(!f.calls.some(c=>c.url.includes('mvlink.blog')));assert(!f.calls.some(c=>c.url.includes('hshare.lol')));
});
test('418 HM: nonnumeric advertised embed paths do not invent REST post IDs or source links',async()=>{
 const f=fixture({embedURL:'https://mvlink.blog/abc123',htmlDelay:1}),out=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567'});assert.equal(out.length,2);assert(!f.calls.some(c=>c.url.includes('mvlink.blog/wp-json/')));
});
test('418 HM: equivalent embed requests remain within the existing global concurrency of three',async()=>{
 let active=0,max=0;const names=Array.from({length:6},(_,i)=>'Example.File'+i+'.1080p.mkv');
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  assert(!url.includes('.workers.dev'));
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:post}]));if(url.includes('/?s='))return reply('');
  if(url===post)return reply(names.map((n,i)=>'<h3>1080p</h3><a href="https://mvlink.blog/'+(100+i)+'">Links</a>').join(''));
  if(url.includes('mvlink.blog')){active++;max=Math.max(max,active);const i=Number(url.match(/(\d+)\/?$/)[1])-100;try{return await delayed('<a href="'+source(names[i])+'">File</a>',url.includes('/wp-json/')?8:80,signal);}finally{active--;}}
  if(url.includes('hshare.lol'))return reply('<a href="'+hub(new URL(url).searchParams.get('id'))+'">Hub</a>');throw Error(url);
 }});
 const out=await h.cards('Example','movie',0,0,null,1000,{imdb:'tt1234567'});assert.equal(out.length,6);assert(max<=3);assert(max>=2);assert(!out.$pend);
});
test('418 HM: expired route deadlines perform no search, representation race or mirror call',async()=>{
 const f=fixture(),out=await f.h.cards('Example','movie',0,0,null,11000,{imdb:'tt1234567',deadline:Date.now()-1});assert.equal(out.length,0);assert.equal(f.calls.length,0);
});

test('418 HM: an early REST list cannot hide additional files in slower canonical HTML',async()=>{
 const a='Example.A.1080p.mkv',b='Example.B.2160p.mkv',f=fixture({htmlDelay:160,restNames:[a],htmlNames:[a,b]});
 const out=await f.h.cards('Example','movie',0,0,null,600,{imdb:'tt1234567'});assert.equal(new Set(out.map(c=>c.filename)).size,2);assert(out.some(c=>c.filename===a));assert(out.some(c=>c.filename===b));assert(!out.$pend);assert(f.h.last().firstCardMs<140,'REST file work must overlap canonical discovery');assert(f.h.last().discoveryMs>=150,'canonical completion must not be cut at the first usable representation');
});
test('418 HM: pending canonical HTML never freezes a partial REST-only plan or positive card cache',async()=>{
 const a='Example.A.1080p.mkv',b='Example.B.2160p.mkv',f=fixture({restNames:[a],htmlNames:[a,b]});
 const first=await f.h.cards('Example','movie',0,0,null,300,{imdb:'tt1234567'});assert.equal(new Set(first.map(c=>c.filename)).size,1);assert.equal(first.$pend,true);f.setHTMLDelay(1);
 const next=await f.h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(new Set(next.map(c=>c.filename)).size,2);assert(!next.$pend);const count=f.calls.length;assert.equal((await f.h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'})).length,next.length);assert.equal(f.calls.length,count);
});

test('418 HM: failed canonical HTML cannot certify an earlier REST-only plan complete',async()=>{
 const f=fixture({htmlDelay:120,htmlFailure:true}),out=await f.h.cards('Example','movie',0,0,null,600,{imdb:'tt1234567'});
 assert.equal(out.length,2,'keep the mirrors already resolved from advertised REST links');assert.equal(out.$pend,true,'a canonical network failure is not proof that all files were collected');
 const before=f.calls.length;await f.h.cards('Example','movie',0,0,null,600,{imdb:'tt1234567'});assert(f.calls.length>before,'incomplete cards/plans must not become a positive cache hit');
});
test('418 HM: canonical and REST provenance deltas share one per-file gdshine POST without losing either Hub',async()=>{
 const calls=[],short='abcdefghi',a=hub('rest.mkv'),b=hub('canonical.mkv'),fast='https://fast.workers.dev/d/ready';
 const links=host=>'<a href="https://'+host+'/?id='+encodeURIComponent(file)+'">File</a>';
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  assert(!url.includes('.workers.dev'),'No media request');calls.push({url,body});
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:post}]));if(url.includes('/?s='))return reply('');
  if(url===post)return reply('<a href="https://imdb.com/title/tt1234567">IMDb</a><h3>1080p</h3><a href="'+embed+'">Links</a>');
  if(url===embed)return delayed(links('boldb.site'),120,signal);
  if(url.includes('mvlink.blog/wp-json/'))return delayed(JSON.stringify({content:{rendered:links('hshare.lol')}}),5,signal);
  if(url.includes('hshare.lol')||url.includes('boldb.site'))return delayed('<a href="'+(url.includes('hshare.lol')?a:b)+'">Hub</a><a href="https://gdshine.org/s/'+short+'">Fast</a>',5,signal);
  if(url.includes('/api/share/'))return delayed('{"data":{"file":{"id":"file-id"}}}',5,signal);
  if(url.includes('/via-worker'))return delayed(JSON.stringify({data:{copyUrl:fast}}),90,signal);
  throw Error(url);
 }});
 const out=await h.cards('Example','movie',0,0,null,600,{imdb:'tt1234567'});assert.deepEqual(out.map(c=>c.url).sort(),[a,b,fast].sort());assert(!out.$pend);assert.equal(calls.filter(c=>c.url.includes('/via-worker')&&c.body==='{}').length,1);assert.equal(calls.filter(c=>c.url.includes('/api/share/')).length,1);
});
