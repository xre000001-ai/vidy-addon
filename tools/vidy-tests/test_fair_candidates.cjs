'use strict';const assert=require('assert'),{merge}=require('../vidy-runtime/fair_candidates.cjs');
assert.deepEqual(merge([['a','b','c','d'],['x','y'],['q','x']],x=>x!=='b'),['a','x','q','y','c','d']);
assert.equal(merge([['a','b'],['x','y']],()=>true,2).length,2);
console.log('Fair candidate merge prevents source starvation; filters, deduplication and cap passed');
