'use strict';
const assert=require('assert');
global.fetch=async()=>{throw Error('simulated offline')};
const idx=require('./runtime_index');
(async()=>{const st=idx.stats();assert(st.bootstrap);assert(st.posts>=36000);const rows=await idx.candidates(['Take Charge of My Heart'],2026,'series',1,2,20);assert(rows.some(r=>r._sav.some(x=>x.id==='5VRfFkN6')));await new Promise(r=>setTimeout(r,50));assert(idx.stats().posts>=36000,'failed network refresh retains seed');console.log('offline bootstrap index and failed refresh passed')})().catch(e=>{console.error(e);process.exit(1)});
