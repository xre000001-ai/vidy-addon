'use strict';const assert=require('assert'),{create}=require('./proxy_groups.cjs');
const servers=['miami','boise','atlanta','munich','chicago','vegas','oakland','portland','reno'];
const g=create(servers,['a','b','c','d','e','f']);
assert.deepEqual(servers.map(g.first),['a','a','a','b','b','b','c','c','c']);
for(const srv of servers)assert(g.take(g.pick(srv),srv));assert.equal(g.count('a'),3);assert(!g.take('a','chicago'));
for(const [i,srv] of servers.entries())assert.equal(g.pick(srv,new Set([g.first(srv)])),['d','e','f'][Math.floor(i/3)]);
const h=create(servers,['one','two']);assert.equal(h.first('reno'),undefined);assert.equal(h.pick('reno'),undefined);assert.equal(h.pick('miami',new Set(['one'])),undefined);
console.log('Nine servers use three distinct initial proxies, max three each; disjoint retry lanes');
