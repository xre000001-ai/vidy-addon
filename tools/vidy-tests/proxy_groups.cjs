'use strict';
// Each successive three-server group owns a distinct initial proxy. Retry
// lanes are also disjoint; a proxy can never serve >3 distinct servers in a
// request, even when groups encounter failures at different times.
function create(servers,nodes,cap=3){
 const list=[...new Set(nodes.filter(Boolean))], groups=new Map(), use=new Map();
 const ng=Math.ceil(servers.length/cap);
 servers.forEach((srv,i)=>groups.set(srv,Math.floor(i/cap)));
 const first=srv=>{const n=groups.get(srv);return n===undefined?undefined:list[n];};
 const take=(px,srv)=>{let s=use.get(px);if(!s){s=new Set();use.set(px,s);}if(!s.has(srv)&&s.size>=cap)return false;s.add(srv);return true;};
 const pick=(srv,excluded,usable)=>{
  const g=groups.get(srv);if(g===undefined||!ng)return undefined;
  for(let i=g;i<list.length;i+=ng){const px=list[i];if(excluded&&excluded.has(px))continue;if(usable&&!usable(px))continue;const s=use.get(px);if(s&&!s.has(srv)&&s.size>=cap)continue;return px;}
  return undefined;
 };
 return {first,take,pick,count:px=>(use.get(px)||new Set()).size};
}
module.exports={create};
