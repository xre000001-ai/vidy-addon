'use strict';
// Explicitly verified post identity: MLSBD's Obsession (2026) article describes
// Curry Barker's One Wish Willow film (IMDb tt37287335 / TMDB 1339713).
// Same-title, same-year titles cannot safely share this post by name alone.
function postAllowed(post,type,requestId){
 const id=String((post&&post.id)||'');
 const url=String((post&&(post.link||post.url))||'');
 const known=id==='376652'||/\/obsession-2026-english-amazon-web-dl-480p-720p-1080p-4k-x264-400mb-1-1gb-2-3gb-9-5gb-download-watch-online\/?(?:[?#]|$)/i.test(url);
 if(!known)return true;
 if(type!=='movie')return false;
 const ident=String(requestId||'').replace(/^tmdb/i,'').toLowerCase();
 return !ident || ident==='1339713' || ident==='tt37287335';
}
module.exports={postAllowed};
