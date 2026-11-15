'use strict';
const assert=require('assert');const {create}=require('./partial_deadline');
(async()=>{
 let count=0,lastCard=0,start=Date.now();
 let gate=create({started:start,minMs:110,maxMs:350,quietMs:60,pollMs:5,snapshot:()=>({count,lastCard})});
 setTimeout(()=>{count++;lastCard=Date.now()},30);setTimeout(()=>{count++;lastCard=Date.now()},95);
 await gate.promise;let elapsed=Date.now()-start;assert(count===2);assert(elapsed>=145&&elapsed<300,'must collect cards through quiet period and finish before hard deadline');
 start=Date.now();gate=create({started:start,minMs:35,maxMs:130,quietMs:20,pollMs:5,snapshot:()=>({count:0,lastCard:0})});await gate.promise;elapsed=Date.now()-start;assert(elapsed>=125,'empty does not cut off before maximum');
 start=Date.now();gate=create({started:start,minMs:20,maxMs:75,quietMs:1000,pollMs:5,snapshot:()=>({count:1,lastCard:Date.now()})});await gate.promise;assert(Date.now()-start>=70,'continuous arrivals stop at max');
 // Production min equals max: one early card must not cut a still-running
 // mirror; all parallel jobs may instead settle naturally before the deadline.
 count=1;lastCard=Date.now();start=Date.now();
 gate=create({started:start,minMs:140,maxMs:140,quietMs:15,pollMs:5,snapshot:()=>({count,lastCard})});
 setTimeout(()=>{count++;lastCard=Date.now();},100);await gate.promise;
 assert.equal(count,2,'later mirror preserved');assert(Date.now()-start>=135,'do not cut while slower mirrors run');
 gate=create({minMs:100,maxMs:200,snapshot:()=>({count:0,lastCard:0})});gate.cancel();console.log('parallel partial deadline preserves quiet-period cards, empty wait and hard cap');
})().catch(e=>{console.error(e);process.exit(1)});
