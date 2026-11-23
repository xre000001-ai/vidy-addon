'use strict';
// Exact, reversible CineJoy stability delta on the deployed 4d92bf8 tree.
// Older preservation checks consume these reconstructed bytes, not exemptions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),edits=require('./fixtures/stability-authorized-edits.json');
const {beforeCardText}=require('../card-text-tests/preservation.cjs');
function beforeStability(file){
 let value=beforeCardText(file);const undo=edits.filter(e=>e.file===file).reverse();
 if(undo.length){let text=value.toString('utf8');for(const e of undo){const count=text.split(e.new).length-1;assert.equal(count,e.count,'Exact stability inverse: '+file+' ('+e.reason+')');text=text.split(e.new).join(e.old);}value=Buffer.from(text);}
 return value;
}
module.exports={beforeStability};
