'use strict';
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'../../server.js'),'utf8');
function extract(a,b){const start=src.indexOf(a),end=src.indexOf(b,start);if(start<0||end<0) throw Error('parser not found');return src.slice(start,end)}
const ctx={Buffer};vm.createContext(ctx);
vm.runInContext(extract('function mlbdDec(', 'async function mlbdSearch(')+extract('function mlbdAbs(', 'async function mlbdTitleFiles('),ctx);
const html=fs.readFileSync(process.argv[2],'utf8');
const items=ctx.mlbdToksLab(html).filter(x=>/^\/file\/[A-Za-z0-9_-]+$/.test(x.t));
const groups=ctx.mlbdEpGroups(html).map(g=>({season:g.s||null,episode:g.e,toks:g.toks.filter(t=>/^\/file\/[A-Za-z0-9_-]+$/.test(t))}));
process.stdout.write(JSON.stringify({items,groups}));
