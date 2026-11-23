'use strict';
// Compile the smallest complete top-level function, not the remainder of a
// provider module. This never evaluates imports, sockets or background work.
const vm=require('node:vm'),assert=require('node:assert/strict');
function namedFunction(source,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=new RegExp('^(?:async )?function '+escaped+'\\(', 'm').exec(source);
 assert(match,'Missing real function '+name);
 const start=match.index, ends=/\}/g;ends.lastIndex=start;
 let end;
 while((end=ends.exec(source))){
  const code=source.slice(start,end.index+1);
  try{new vm.Script(code,{filename:name+'.extracted.js'});return code;}catch(e){if(!(e instanceof SyntaxError))throw e;}
 }
 throw Error('No complete function boundary: '+name);
}
module.exports={namedFunction};
