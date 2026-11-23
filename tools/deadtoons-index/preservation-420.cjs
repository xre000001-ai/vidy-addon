'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),edits=require('./fixtures/authorized-420-edits.json');
function before420(file){
 let data=fs.readFileSync(path.join(root,file));
 const lengths={'tools/source-review-tests/fixtures/rereview-edits.json':68,'tools/deadtoons-index/fixtures/authorized-edits.json':29};
 if(lengths[file]){const all=JSON.parse(data);assert.deepEqual(all.slice(lengths[file]),edits,'Exactly declared420 inverse additions');return Buffer.from(JSON.stringify(all.slice(0,lengths[file]),null,2)+'\n');}
 const mine=edits.filter(e=>e.file===file).reverse();if(!mine.length)return data;
 let text=data.toString('utf8');for(const e of mine){assert.equal(text.split(e.new).length-1,e.count,'Exact420 inverse: '+file+' '+e.reason);text=text.split(e.new).join(e.old);}return Buffer.from(text);
}
module.exports={before420};
