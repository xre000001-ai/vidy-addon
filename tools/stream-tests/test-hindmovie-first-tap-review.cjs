'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),hm=require('../vidy-runtime/hindmovie.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),reply=t=>({st:200,t}),file='Example.2020.1080p.mkv',post='https://v5.hindmovie.im/example-2020-hindi-1080p/',source='https://boldb.site/?id='+encodeURIComponent(file),worker='https://hub.workers.dev/0:/'+file;
function fixture({slowWorker=false,workerDelay=0,slowIdentity=false}={}){
 const calls=[],signals=[],state={slowWorker};
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  calls.push({url,ms,at:Date.now(),signal});
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:post}]));
  if(url.includes('/?s='))return reply('');
  if(url===post)return reply('<a href="https://imdb.com/title/tt1234567">IMDb</a><a href="'+source+'">Links</a>');
  if(url===source)return reply('<a href="'+worker+'">Hub</a><a href="https://gdshine.org/s/abcdefghi">Fast</a>');
  if(url.includes('/api/share/'))return reply('{"data":{"file":{"id":"file-id"}}}');
  if(url.includes('/via-worker')){
   signals.push(signal);
   if(state.slowWorker)return new Promise(resolve=>{if(signal?.aborted)resolve(reply(''));else signal?.addEventListener('abort',()=>resolve(reply('')),{once:true});});
   if(workerDelay)await wait(workerDelay);
   return reply('{"data":{"copyUrl":"https://fast.workers.dev/d/ready"}}');
  }
  return reply('');
 }});return {h,calls,signals,state};
}
test('HM review: a transient cold search failure gets one useful retry inside the same absolute budget',async()=>{
 let searches=0;const h=hm.create({get:async(url,ms)=>{
  if(url.includes('/wp-json/wp/v2/search')||url.includes('/?s=')){searches++;if(searches<=2)return {st:0,t:''};return url.includes('/wp-json/')?reply(JSON.stringify([{url:post}])):reply('');}
  if(url===post)return reply('<a href="'+source+'">Links</a>');
  if(url===source)return reply('<a href="'+worker+'">Hub</a>');return reply('');
 }});const began=Date.now(),out=await h.cards('Example','movie',0,0,null,1000,{imdb:'tt1234567',deadline:began+1000});assert.equal(out.length,1);assert.equal(searches,4);assert.equal(h.last().searchAttempts,2);assert(Date.now()-began<1000);assert(!out.$pend);
});
test('HM review: a successful genuinely empty search does not issue a wasteful retry',async()=>{
 let searches=0;const h=hm.create({get:async()=>{searches++;return reply('');}}),out=await h.cards('Absent','movie',0,0,null,1000);assert.equal(out.length,0);assert.equal(searches,2);assert(!out.$pend);
});
test('HM review: repeatedly failed search stays pending, with no more than one retry or fake complete cache',async()=>{
 let searches=0;const h=hm.create({get:async()=>{searches++;return {st:0,t:''};}}),out=await h.cards('Example','movie',0,0,null,1000);assert.equal(out.length,0);assert.equal(searches,4);assert.equal(out.$pend,true);
});
test('HM review: a ready Hub is retained at the same-tap deadline while a Fast API is stalled',async()=>{
 const {h,signals}=fixture({slowWorker:true}),began=Date.now();const out=await h.cards('Example','movie',0,0,null,180,{imdb:'tt1234567'});
 assert.equal(out.length,1,'a ready advertised Hub must not be hidden behind another mirror');assert.equal(out[0].url,worker);assert.equal(out.$pend,true);assert(h.last().firstCardMs<120);assert(Date.now()-began<420);assert.equal(signals.length,1);assert.equal(signals[0]?.aborted,true,'stop the unfinished metadata request at the source deadline');
});
test('HM review: a partial first response cannot pin an incomplete positive card cache',async()=>{
 const f=fixture({slowWorker:true});const first=await f.h.cards('Example','movie',0,0,null,140,{imdb:'tt1234567'});assert.equal(first.length,1);f.state.slowWorker=false;
 const second=await f.h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(second.length,2);assert(!second.$pend);const n=f.calls.length;const third=await f.h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(third.length,2);assert.equal(f.calls.length,n);
});
test('HM review: a failed embed cannot freeze an incomplete file plan or positive card cache',async()=>{
 let recovered=false,embedCalls=0;const second='Example.Second.1080p.mkv',embed='https://mvlink.blog/1234';
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:post}]));
  if(url.includes('/?s='))return reply('');
  if(url===post)return reply('<a href="'+source+'">First</a><h3>1080p</h3><a href="'+embed+'">More</a>');
  if(url===embed||url.includes('/wp-json/wp/v2/posts/1234')){embedCalls++;return recovered?reply('<a href="https://boldb.site/?id='+second+'">Second</a>'):{st:0,t:''};}
  if(url.includes('boldb.site'))return reply('<a href="https://hub.workers.dev/0:/'+new URL(url).searchParams.get('id')+'">Hub</a>');
  return reply('');
 }});
 const first=await h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(first.length,1);assert.equal(first.$pend,true);const n=embedCalls;recovered=true;
 const next=await h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(next.length,2);assert(!next.$pend);assert(embedCalls>n);
});
test('HM review: all advertised mirrors still complete together when they fit the budget; no first-card early return',async()=>{
 const {h}=fixture({workerDelay:65}),began=Date.now(),out=await h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(out.length,2);assert(!out.$pend);assert(Date.now()-began>=55);assert(h.last().firstCardMs<50);
});
test('HM review: an absolute deadline includes elapsed route/metadata time, not a fresh eleven seconds',async()=>{
 const {h}=fixture({slowWorker:true}),began=Date.now(),out=await h.cards('Example','movie',0,0,null,11000,{imdb:'tt1234567',deadline:Date.now()+140});assert.equal(out.length,1);assert.equal(out.$pend,true);assert(Date.now()-began<400);
});
test('HM review: an already expired deadline performs no source requests or cache mutations',async()=>{
 const {h,calls}=fixture(),out=await h.cards('Example','movie',0,0,null,11000,{imdb:'tt1234567',deadline:Date.now()-10});assert.equal(out.length,0);assert.equal(calls.length,0);
});
test('HM review: a confirmed wrong IMDb never emits a progressive mirror',async()=>{
 const {h,calls}=fixture(),out=await h.cards('Example','movie',0,0,null,500,{imdb:'tt7654321'});assert.equal(out.length,0);assert(!calls.some(c=>/boldb|gdshine|workers\.dev/.test(c.url)));
});
test('HM review: a winning canonical search cancels its equivalent losing request',async()=>{
 let losingSignal,loserAborted=false;
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  if(url.includes('/wp-json/')){losingSignal=signal;return new Promise(resolve=>{signal?.addEventListener('abort',()=>{loserAborted=true;resolve(reply('[]'));},{once:true});});}
  await wait(5);return reply('<a href="'+post+'">Example</a>');
 }});const result=await h.search('Example',400);assert.equal(result[0],post);assert.equal(losingSignal?.aborted,true);assert.equal(loserAborted,true);
});
test('HM review: extraction never adds media, HEAD or Range verification to the first tap',async()=>{
 const {h,calls}=fixture();const out=await h.cards('Example','movie',0,0,null,500,{imdb:'tt1234567'});assert.equal(out.length,2);assert(calls.every(c=>!c.url.includes('.workers.dev')&&!c.url.includes('hcloud.')));assert(calls.every(c=>Number.isFinite(c.ms)&&c.ms>0&&c.ms<=500));
});
test('HM review: queued files retain their own request context after another title times out',async()=>{
 const slowNames=Array.from({length:10},(_,i)=>'Example.File'+i+'.1080p.mkv'),otherName='Other.2020.1080p.mkv',calls=[];
 const otherPost='https://v5.hindmovie.im/other-2020-hindi-1080p/';
 const h=hm.create({get:async(url,ms,ref,body,signal)=>{
  if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:url.includes('Other')?otherPost:post}]));
  if(url.includes('/?s='))return reply('');
  if(url===post||url===otherPost)return reply((url===post?slowNames:[otherName]).map(n=>'<a href="https://boldb.site/?id='+encodeURIComponent(n)+'">File</a>').join(''));
  if(url.includes('boldb.site')){
   const name=new URL(url).searchParams.get('id');calls.push({name,ms,aborted:signal?.aborted});
   if(name.startsWith('Example'))return new Promise(resolve=>{if(signal?.aborted)resolve(reply(''));else signal?.addEventListener('abort',()=>resolve(reply('')),{once:true});});
   await wait(30);return reply('<a href="https://hub.workers.dev/0:/'+name+'">Hub</a>');
  }
  return reply('');
 }});
 const first=h.cards('Example','movie',0,0,null,180,{key:'first'});await wait(20);const second=h.cards('Other','movie',0,0,null,650,{key:'second'});
 const [a,b]=await Promise.all([first,second]);assert.equal(a.length,0);assert.equal(b.length,1);assert.equal(b[0].filename,otherName);assert.equal(calls.filter(c=>c.name.startsWith('Example')).length,8);assert.equal(calls.find(c=>c.name===otherName).aborted,false);
});
