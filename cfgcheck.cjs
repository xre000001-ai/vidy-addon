const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/user/vidy-work/w2x/config.html','utf8'),{runScripts:'dangerously',url:'http://127.0.0.1:7000/configure',pretendToBeVisual:true,beforeParse(w){w.fetch=()=>Promise.resolve({ok:false});}});
const errs=[]; dom.window.addEventListener('error',e=>errs.push(e.message));
setTimeout(()=>{const d=dom.window.document;
  console.log('cards:',d.querySelectorAll('#srcGrid .card').length,'| card-nex:',!!d.getElementById('card-nex'),'| tune-nex rows:',d.querySelectorAll('#tune-nex .chips').length,'| errs:',errs.slice(0,2));
},900);
