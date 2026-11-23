'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),edits=require('./fixtures/authorized-edits.json');
function beforeDeadtoons(file){
 let value=fs.readFileSync(path.join(root,file));
 if(file==='tools/source-review-tests/fixtures/rereview-edits.json'){
  const all=JSON.parse(value),ours=all.slice(39);assert.deepEqual(ours,edits,'All and only declared DT inverse hunks');value=Buffer.from(JSON.stringify(all.slice(0,39),null,2)+'\n');
 }else for(const e of edits.filter(e=>e.file===file).reverse()){
  const old=Buffer.from(e.old),current=Buffer.from(e.new),text=value.toString('utf8');assert.equal(text.split(e.new).length-1,e.count,'Exact DT inverse: '+file+' '+e.reason);value=Buffer.from(text.split(e.new).join(e.old));
 }
 return value;
}
module.exports={beforeDeadtoons};
