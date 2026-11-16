'use strict';const assert=require('assert'),{create}=require('./proxy_groups.cjs');
const g=create(['miami','boise','atlanta','munich','chicago'],['a','b']);
assert.deepEqual(['miami','boise','atlanta','munich','chicago'].map(g.first),['a','a','a','b','b']);
for(const srv of ['miami','boise','atlanta'])assert(g.take('a',srv));
assert(g.take('a','miami'));assert(!g.take('a','chicago'));assert(g.take('b','chicago'));assert.equal(g.count('a'),3);
const h=create(['a','b','c','d'],[]);assert.equal(h.first('a'),undefined);assert(h.take('x','a'));console.log('Three-server proxy grouping, fallback limits and empty pool passed');
