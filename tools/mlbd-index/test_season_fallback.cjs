'use strict';
const assert=require('node:assert'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../server.js'),'utf8');
const a=source.indexOf('      // A nonempty search can consist entirely');
const b=source.indexOf("      if (DBG) console.error('[mlbd] search n='",a);
assert(a>=0 && b>a,'fallback block exists');
async function run(items,type='series',remaining=4000){
 const calls=[];const ctx={items, type, name:'Example',year:2020,SE:2,EP:1,base:'https://example.com',left:()=>remaining,
  mlbdPicks:arr=>arr.filter(x=>x.valid),mlbdSearch:async(base,q)=>{calls.push(q);return [{valid:true,title:q}]},Promise,Math};
 vm.createContext(ctx);await vm.runInContext('(async()=>{'+source.slice(a,b)+'})()',ctx);return {calls,items};
}
(async()=>{
 const a=await run([{valid:false,title:'unrelated'}]);assert.equal(a.calls.length,2);assert.equal(a.items.length,3);
 const b=await run([{valid:true}]);assert.equal(b.calls.length,0);
 const c=await run([], 'movie');assert.equal(c.calls.length,0);
 const d=await run([], 'series',2500);assert.equal(d.calls.length,0);
 console.log('Unrelated search results no longer suppress season-specific fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
