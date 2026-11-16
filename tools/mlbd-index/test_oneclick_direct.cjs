'use strict';
const assert=require('node:assert'),x=require('./oneclick_direct.cjs');
const p='/file/'+'A'.repeat(55),name='Other.Mommy.2026.2160p.Dual.mkv';
assert.equal(x.path(`<a data-host="oneclick" href="${p}">`),p);assert.equal(x.path(`<a data-host="oneclick" href="https://evil.test${p}">`),'');assert.equal(x.path(`<a data-host="fsl" href="${p}">`),'');
const page=`<title>MovieLinkBD.com - ${name}</title><a data-host="instant" href="https://a.r2.cloudflarestorage.com/movielinkbd/media/Ab1234/main?X=1&amp;Y=2"></a><a data-host="ultra" href="https://pub-${'a'.repeat(32)}.r2.dev/media/Ab1234/main"></a>`;
assert.deepEqual(x.media(page,name).map(x=>x.s),['One Click Fast Cloud','One Click Ultra']);assert.equal(x.media(page,'Other Film').length,0);assert.equal(x.media(page.replace('a.r2.cloudflarestorage.com','evil.test'),name).length,1);assert.equal(x.media(page.replace('/media/Ab1234/main','/wrong'),name).length,1);
console.log('Explicit One Click servers accepted only for same file and allowed hosts');
