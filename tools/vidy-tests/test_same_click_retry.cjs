'use strict';const assert=require('assert'),{run}=require('./same_click_retry.cjs');
const after=(ms,x)=>new Promise(r=>setTimeout(()=>r(x),ms));
(async()=>{
 let count=0;let x=await run(()=>after(2,{ok:true,id:1}),()=>{count++;return {ok:true}},20);assert.equal(x.id,1);assert.equal(count,0);
 x=await run(()=>after(2,{ok:false}),()=>{count++;return after(3,{ok:true,id:2})},20);assert.equal(x.id,2);assert.equal(count,1);
 x=await run(()=>after(30,{ok:true,id:3}),()=>after(3,{ok:false}),5);assert.equal(x.id,3);
 x=await run(()=>after(40,{ok:false}),()=>after(4,{ok:true,id:4}),5);assert.equal(x.id,4);
 x=await run(()=>Promise.reject(Error('network')),()=>after(1,{ok:false,id:5}),10);assert.equal(x.id,5);
 console.log('First-click retry covers failure and slow attempts; first successful result preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
