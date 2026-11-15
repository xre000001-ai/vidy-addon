'use strict';
const assert=require('assert'),{find}=require('./gd_resume');
const link=(href,label='Cloud Resume Download')=>`<a class="btn" href="${href}"><i class="fas fa-arrow-down"></i> ${label} </a>`;
const base='https://cloud-dl.abc123.workers.dev/abc/File name S01E05 1080p.mkv?bytes=123&amp;a=2';
assert.equal(find(link(base)),'https://cloud-dl.abc123.workers.dev/abc/File%20name%20S01E05%201080p.mkv?bytes=123&a=2');
for (const h of ['https://fast.rixinof959.workers.dev/x/My%20Demon%201080p.mkv','https://east.aws-eu.xyz/x/My%20Demon%201080p.mkv']) assert.equal(find(link(h)),h);
for (const h of ['https://fast.example.workers.dev.evil.test/a/x.mkv','https://east.aws-eu.xyz.evil.test/a/x.mkv','https://random.abc.workers.dev/a/x.mkv'])assert.equal(find(link(h)),'');
for(const h of ['https://cloud-dl.abc123.workers.dev/a/file.mkv.zip','https://cloud-dl.abc123.workers.dev/a/file.zip?bytes=1','https://cloud-dl.abc123.workers.dev.evil.test/a/file.mkv','https://evil.test/a/file.mkv','http://cloud-dl.abc123.workers.dev/a/file.mkv','https://cloud-dl.abc123.workers.dev/a/file.html'])assert.equal(find(link(h)),'',h);
assert.equal(find(link(base,'Some other download')),'');
const fs=require('fs');const real='/home/user/gd-lantern-nfpTZGld4tHdeGn.html';if(fs.existsSync(real)){const u=find(fs.readFileSync(real,'utf8'));assert(u.includes('1080p')===false);assert(u.includes('4K.mkv'));}
console.log('GDFlix Cloud Resume anchor, full URL, video, ZIP fallback and strict host tests passed');
