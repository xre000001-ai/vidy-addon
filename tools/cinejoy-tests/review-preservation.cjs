'use strict';
// Reconstruct exact 07d669f bytes, then run the original 74aa4fa hash checks.
// Separately account for already-published bot index updates: no exempt files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../..'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const edits=require('./fixtures/careful-review-authorized-edits.json'),upstream=require('./fixtures/careful-review-upstream-index.json');
const {beforeStability}=require('./stability-preservation.cjs');
function beforeReview(file){
 let value=beforeStability(file);
 const undo=edits.filter(e=>e.file===file).reverse();
 if(undo.length){
  let text=value.toString('utf8');
  for(const e of undo){const count=text.split(e.new).length-1;assert.equal(count,e.count,'Exact authorized review inverse: '+e.file+' ('+e.reason+')');text=text.split(e.new).join(e.old);}
  value=Buffer.from(text);
 }
 const inherited=upstream.files[file];
 if(inherited){
  assert.match(file,/^dti\/(?:manifest|s\d{2})\.json$/);assert.equal(hash(value),inherited.afterSha256,'Exact inherited bot index: '+file);
  value=zlib.gunzipSync(Buffer.from(inherited.beforeGzipBase64,'base64'),{maxOutputLength:2*1024*1024});
  assert.equal(hash(value),inherited.beforeSha256,'Exact archived pre-bot index: '+file);
 }
 return value;
}
module.exports={beforeReview};
