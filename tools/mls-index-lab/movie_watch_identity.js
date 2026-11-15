'use strict';
// Unknown-quality movie links must be validated against the actual filename.
// Require an exact year when metadata provides one, not title alone or ±1.
function valid(filename,names,year,titleMatches){
 const t=String(filename||'');
 const ys=[...t.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m=>Number(m[0]));
 return !!t && !/\b(?:S\d{1,2}(?:E\d{1,4})?|Season\s*\d{1,2})\b/i.test(t) && (!year || ys.includes(Number(year))) && (names||[]).some(n=>titleMatches(n,t,year,false));
}
module.exports={valid};
