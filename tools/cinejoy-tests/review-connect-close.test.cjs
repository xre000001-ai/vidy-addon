'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const undici=require('undici'),{Session}=require('../vidy-runtime/cinejoy-pk/src/transport.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('review: a stalled real CONNECT is destroyed promptly, rather than freezing CineJoy refill for minutes',async()=>{
 const sockets=new Set(),clients=[],seen=[];const server=net.createServer(socket=>{sockets.add(socket);socket.on('data',b=>seen.push(b.toString().split('\r\n')[0]));socket.on('close',()=>sockets.delete(socket));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const local='http://127.0.0.1:'+server.address().port;
 class LocalProxyAgent extends undici.ProxyAgent{
  constructor(options){
   super({...options,uri:local,clientFactory:(url,opts)=>{const c=options.clientFactory?options.clientFactory(url,opts):new undici.Client(url,opts);clients.push(c);return c;}});
  }
 }
 const filename=path.resolve(__dirname,'../vidy-runtime/cinejoy-pk/src/transport.cjs'),code=fs.readFileSync(filename,'utf8'),ctx={require:n=>n==='./deps.cjs'?()=>({...undici,ProxyAgent:LocalProxyAgent}):require(path.resolve(path.dirname(filename),n)),module:{exports:{}},AbortController,AbortSignal,setTimeout,clearTimeout,Buffer,URL};
 vm.runInNewContext(code,ctx,{filename});const s=new ctx.module.exports.Session('http://8.8.8.8:3128',{timeout:100});
 let closing;
 try{
  const request=s.get('https://api2.wing.st/g').then(()=>({code:'UNEXPECTED_SUCCESS'}),e=>e);
  const failure=await Promise.race([request,delay(350).then(()=>({code:'HARNESS_REQUEST_STALLED'}))]);
  assert(seen.some(x=>x.startsWith('CONNECT ')),'must exercise a real hanging CONNECT, not only a mocked close');
  const began=Date.now();closing=s.close();const outcome=await Promise.race([closing.then(()=>true),delay(300).then(()=>false)]);
  assert.equal(failure.code,'TIMEOUT','the local timer must reject even when undici is still opening CONNECT');assert.equal(outcome,true,'ProxyAgent.destroy waits for CONNECT if its internal proxy client is not explicitly destroyed');assert(Date.now()-began<300);
 }finally{
  // Close the blackhole itself BEFORE awaiting a deliberately broken old agent.
  const stopped=new Promise(r=>server.close(r));for(const socket of sockets)socket.destroy();await stopped;
  await Promise.race([Promise.allSettled(clients.map(c=>c.destroy())),delay(500)]);await Promise.race([closing?.catch(()=>{}),delay(500)]);
 }
});
test('review: concurrent Session.close calls share completion and cannot report cleanup done early',async()=>{
 const s=new Session(null);await s.dispatcher.destroy();let release,calls=0;const gate=new Promise(r=>{release=r;});s.dispatcher={destroy:()=>{calls++;return gate;}};
 const a=s.close(),b=s.close();let bDone=false;b.then(()=>{bDone=true;});try{await delay(10);assert.equal(bDone,false);assert.equal(calls,1);assert.equal(s.closed,true);}finally{release();await Promise.all([a,b]);}
});
test('review: a failed destroy cannot report close completion before the other socket layer has drained',async()=>{
 const s=new Session(null);await s.dispatcher.destroy();let release,done=false;const gate=new Promise(r=>{release=r;});s.dispatcher={destroy:()=>gate};s.proxyClient={destroy:async()=>{throw Error('test close failure');}};
 const closed=s.close().then(()=>{done=true;return null;},e=>{done=true;return e;});try{await delay(10);assert.equal(done,false,'the lease must remain held while either socket layer is closing');}finally{release();const failure=await closed;assert.equal(failure.message,'test close failure');}
});
test('review: two refill cycles recover from transports that ignore AbortSignal without holding leases or inventing proofs',async()=>{
 const {Engine}=require('../vidy-runtime/cinejoy-pk/src/engine.cjs'),{Refiller}=require('../vidy-runtime/cinejoy-pk/src/refill.cjs'),{fixture,P1,P2}=require('./helpers.cjs');
 const f=fixture(),sessions=[];f.pool.add([P1,P2]);
 const engine=new Engine({pool:f.pool,sessionFactory:p=>{const s=new Session(p,{timeout:40,requestFn:()=>new Promise(()=>{})});sessions.push(s);return s;},resolveSource:async(s,server,input,{signal})=>{await s.get('https://api2.wing.st/g',{signal});assert.fail('an unresponsive transport cannot produce a proof');}});
 const refill=new Refiller(engine,{target:1,limit:2,parallel:2,budgetMs:300});const keepAlive=setInterval(()=>{},50);
 try{
  for(let i=0;i<2;i++){const began=Date.now(),report=await refill.run();assert.equal(report.attempted,2);assert(Date.now()-began<500);assert.equal(refill.status().running,false);assert.equal(f.pool.busy.size,0);assert.equal(engine.pending.size,0);assert.equal(engine.controllers.size,0);assert(Object.values(f.pool.nodes).every(n=>!Object.values(n.servers).some(b=>b.proof)));f.advance(60001);}
  assert.equal(sessions.length,4);assert(sessions.every(s=>s.closed));
 }finally{clearInterval(keepAlive);await refill.close();await engine.close();f.close();}
});
