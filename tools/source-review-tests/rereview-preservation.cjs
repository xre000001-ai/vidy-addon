'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),edits=require('./fixtures/rereview-edits.json');
function beforeRereview(file){
 let value=fs.readFileSync(path.join(root,file));
 for(const edit of edits.filter(e=>e.file===file).reverse()){
  const text=value.toString('utf8');
  assert.equal(text.split(edit.new).length-1,edit.count,'Exact rereview inverse: '+file+' ('+edit.reason+')');
  value=Buffer.from(text.split(edit.new).join(edit.old));
 }
 return value;
}
module.exports={beforeRereview};
