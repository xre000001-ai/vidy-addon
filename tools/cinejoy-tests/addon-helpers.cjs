'use strict';
const {fixture,proof,P1,P2,P3}=require('./helpers.cjs');
const {Engine,wait}=require('../vidy-runtime/cinejoy-pk/src/engine.cjs');
const {parse}=require('../vidy-runtime/cinejoy-pk/src/hls.cjs');
const {proxyId}=require('../vidy-runtime/cinejoy-pk/src/policy.cjs');
const {create,SERVERS}=require('../vidy-runtime/cinejoy.cjs');
const base='https://lightspeed.st/hls/test/master.m3u8?token=a%2Fb';
const master='#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8?sig=a%2Fb"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x1600,CODECS="hvc1.1.6.L153.B0,mp4a.40.2",AUDIO="a",SUBTITLES="s"\n4k/playlist.jpg?key=a%2Fb\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x800,CODECS="avc1.640028,mp4a.40.2",AUDIO="a",SUBTITLES="s"\n1080/playlist.jpg?key=a%2Fb\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x534,CODECS="avc1.64001f,mp4a.40.2",AUDIO="a",SUBTITLES="s"\n720/playlist.jpg?key=a%2Fb\n';
const sample={type:'movie',tmdb:'27205',imdb:'tt1375666',title:'Inception',year:'2010'};
function result(server='Light') { return {server,proxyId:proxyId(P1),streams:[{type:'hls',playlist:base,captions:[{type:'vtt',id:'en',language:'en',url:'https://subs2.wing.st/a.vtt?token=x%2Fy'}]}],manifest:{url:base,text:master,parsed:parse(master,base)}}; }
function getJSON(endpoint) {
 const tv=endpoint.startsWith('/tv/')||endpoint.includes('tt0903747');
 const record={id:tv?1396:27205,[tv?'name':'title']:tv?'Breaking Bad':'Inception',[tv?'first_air_date':'release_date']:tv?'2008-01-20':'2010-07-16',imdb_id:tv?'tt0903747':'tt1375666'};
 return Promise.resolve(endpoint.startsWith('/find/')?{[tv?'tv_results':'movie_results']:[record]}:record);
}
function app({proxies=[P1,P2,P3],env={},resolve,readPlaylist,delay=5,getMetadataJSON=getJSON}={}) {
 const f=fixture({freshMs:10000});f.pool.add(proxies);for(const proxy of proxies)for(const server of SERVERS)f.pool.prove(proxy,server,proof(proxy,server));
 const calls=[],engine=new Engine({pool:f.pool,sessionFactory:proxy=>({id:proxyId(proxy),close:async()=>{}}),resolveSource:async(session,server,input,options)=>{calls.push({proxyId:session.id,server,input,options});if(resolve)return resolve(session,server,input,options);await wait(delay,options.signal);return {...result(server),proxyId:session.id};},readPlaylist:readPlaylist|| (async(session,url,signal)=>({text:master,parsed:parse(master,base),response:{url:base,proxyId:session.id,status:200}}))});
 const source=create({engine,getMetadataJSON,env:{CINEJOY_REFILL:'0',CINEJOY_DISCOVERY:'0',...env},log:()=>{}});
 return {source,engine,pool:f.pool,calls,fixture:f,async close(){await source.close();f.close();}};
}
module.exports={app,result,sample,base,master,getJSON,P1,P2,P3,proof,proxyId,parse,wait,SERVERS};
