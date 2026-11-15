'use strict';
const assert=require('assert'),{resolve}=require('./multicloud_pixel');
const view='https://new2.multicloudlinks.com/view/abc',mirror='https://pixeldra.multicloudlinks.com/?pid=abcdef123',id='Xyz12345';
const valid=`<a href="${mirror}">Pixeldrain Mirror</a>`,wrong='<html><title>Download links</title><p>No mirror</p></html>';
const meta=`<meta property="og:url" content="https://pixeldrain.com/u/${id}"><script>window.viewer_data = ${JSON.stringify({type:'file',api_response:{id,name:'Britto (2019) S01 1080p.mkv',size:100}})};</script>`;
let checked=false;const get=async(u,opt)=>{if(u===view){assert.equal(typeof opt.accept,'function');assert.equal(opt.accept(wrong,view),false);assert.equal(opt.accept(valid,view),true);checked=true;return {body:valid,url:view}}assert.equal(typeof opt.accept,'function');assert(!opt.accept(wrong,view));assert(opt.accept(meta,'https://pixeldrain.com/u/'+id));return {url:'https://pixeldrain.com/u/'+id,body:meta}};
(async()=>{const r=await resolve(view,get,5000);assert(checked);assert.equal(r.direct,'https://pixeldrain.com/api/file/'+id);console.log('Pixeldrain page race requires a real mirror before accepting a response')})().catch(e=>{console.error(e);process.exitCode=1});
