'use strict';
const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function core(t){
 let x=String(t||'').replace(/\((?:19|20)\d{2}\)/g,' ').replace(/\[[^\]]*\]/g,' ');
 x=x.replace(/\b(?:season\s*0*\d{1,2}|s0*\d{1,2})(?!\d)[\s\S]*$/i,' ');
 x=x.replace(/\b(?:hindi|english|bangla|bengali|dual\s+audio|multi\s+audio|org|complete|completed|dubbed|webrip|web[ -]?dl|esub)\b[\s\S]*$/i,' ');
 return normalize(x);
}
function same(name,title){const a=normalize(name),b=core(title);return !!a && a===b;}
module.exports={same,core};
