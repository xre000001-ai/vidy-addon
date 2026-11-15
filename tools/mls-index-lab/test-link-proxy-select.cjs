'use strict';const assert=require('assert'),{select}=require('./link_proxy_select');const now=10000000;
const entries=new Map([['a',{lastOk:now-100,cons:0}],['b',{ban:now+1}],['d',{lastOk:now-100,cons:1}]]);
const pick=turn=>select({ranked:['a','b','c','d'],extra:['e'],entries,now,turn,count:2});
assert.deepEqual(pick(0),['a','c']);assert.deepEqual(pick(1),['a','d']);assert.deepEqual(pick(2),['a','e']);assert(!pick(3).includes('b'));
assert.equal(select({ranked:['1.2.3.4:80','http://1.2.3.4:80','socks5://1.2.3.4:80'],now,count:3}).length,2);
assert.equal(select({ranked:['a'],entries:new Map([['a',{ban:now+1}]]),now}).length,0);
assert.equal(select({ranked:['http://1.2.3.4:80'],entries:new Map([['1.2.3.4:80',{ban:now+1}]]),now}).length,0,'ban applies to equivalent HTTP spellings');
let seen=new Set();for(let i=0;i<20;i++)seen.add(pick(i)[1]);assert.equal(seen.size,3,'exploration must rotate across all non-banned candidates');
console.log('host-specific success, bounded rotating exploration, protocol-aware dedupe and cooldown passed');
