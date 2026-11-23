'use strict';
// This does not change or replace the older HM-only frozen-hash test. It independently
// proves the explicitly authorized CineJoy delta on the exact pre-integration tree.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),base=require('./fixtures/baseline-sha256.json'),edits=require('./fixtures/authorized-edits.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('all 258 pre-existing tracked files retain baseline bytes after reversing only logged CineJoy edits',()=>{
 const content=new Map();for(const[file,expected]of Object.entries(base.sha256)){const p=path.join(root,file);assert(fs.existsSync(p),'Pre-existing file removed: '+file);content.set(file,fs.readFileSync(p));}
 for(const e of [...edits].reverse()){
  const value=content.get(e.file).toString('utf8'),count=value.split(e.new).length-1;assert.equal(count,e.count,'Authorized inverse anchor count in '+e.file);content.set(e.file,Buffer.from(value.split(e.new).join(e.old)));
 }
 for(const[file,expected]of Object.entries(base.sha256))assert.equal(hash(content.get(file)),expected,'Unapproved pre-existing file change: '+file);
});
test('all existing source runtimes, proxy pools and dependency files are unmodified',()=>{for(const[file,expected]of Object.entries(base.sha256)){if(!/^(?:tools\/vidy-runtime\/|.*pool.*\.(?:json|txt)$|package(?:-lock)?\.json$)/.test(file))continue;assert.equal(hash(fs.readFileSync(path.join(root,file))),expected,file);}});
