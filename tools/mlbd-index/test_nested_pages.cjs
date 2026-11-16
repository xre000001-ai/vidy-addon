'use strict';const assert=require('assert'),n=require('./nested_pages.cjs');
const a='/file/'+'A'.repeat(50),b='/file/'+'B'.repeat(50),c='/file/'+'C'.repeat(50),d='/file/'+'D'.repeat(50);
const tag=(p,k)=>`<a href="${p}" data-host="${k}">server</a>`;
assert.deepStrictEqual(n.choose(tag(a,'oneclick')+tag(b,'mp4-entry')+tag(c,'fsl')), [b,c]);
assert.deepStrictEqual(n.choose(tag(a,'oneclick')+tag(b,'fsl')), [b,a]);
assert.deepStrictEqual(n.choose(tag(a,'')+tag(b,'')+tag(c,'')),[a,b]);
assert.deepStrictEqual(n.choose(tag(a,'fsl')+tag(a,'fsl')+tag(d,'mp4-entry')),[d,a]);
assert.deepStrictEqual(n.choose('<a href="/file/short" data-host="fsl">'),[]);
console.log('Nested MovieLinkBD page selection, priority and bounded fallback passed');
