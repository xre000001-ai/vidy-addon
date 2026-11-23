'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),edits=require('./fixtures/authorized-edits.json');
function beforeSourceReview(file){
 let value=require('./rereview-preservation.cjs').beforeRereview(file);
 const undo=edits.filter(e=>e.file===file).reverse();
 if(undo.length){let text=value.toString('utf8');for(const e of undo){assert.equal(text.split(e.new).length-1,e.count,'Exact source-review inverse: '+file+' ('+e.reason+')');text=text.split(e.new).join(e.old);}value=Buffer.from(text);}
 return value;
}
module.exports={beforeSourceReview};
