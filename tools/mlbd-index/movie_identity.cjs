'use strict';
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function core(t){
 let x=String(t||'').replace(/\((?:19|20)\d{2}\)/g,' ').replace(/\[[^\]]*\]/g,' ');
 x=x.replace(/\b(?:full\s+hd|uploaded|hindi|english|bangla|bengali|dual\s+audio|multi\s+audio|org|dubbed|webrip|web[ -]?dl|esub|2160p|1080p|720p|480p|4k)\b[\s\S]*$/i,' ');
 return norm(x);
}
function same(name,title){const a=norm(name),b=core(title);return !!a && (a===b || b===a+' part 1');}
module.exports={same,core};
