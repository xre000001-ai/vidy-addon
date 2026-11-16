'use strict';
// Request-scoped assignment: a proxy may be used by at most three distinct
// servers in this title lookup. Failovers obey the same cap.
function create(servers,nodes,cap=3){
 const list=[...new Set(nodes.filter(Boolean))]; const groups=new Map(), use=new Map();
 servers.forEach((srv,i)=>{if(list.length)groups.set(srv,list[Math.floor(i/cap)%list.length]);});
 return {
  first:srv=>groups.get(srv),
  take:(px,srv)=>{let s=use.get(px);if(!s){s=new Set();use.set(px,s);}if(!s.has(srv)&&s.size>=cap)return false;s.add(srv);return true;},
  count:px=>(use.get(px)||new Set()).size
 };
}
module.exports={create};
