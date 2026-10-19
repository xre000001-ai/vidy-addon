/* config.html DOM-যাচাই — jsdom (npm run test:dom) */
const {JSDOM}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync(__dirname+'/config.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://127.0.0.1:7000/configure',
  beforeParse(w){w.fetch=()=>Promise.resolve({ok:false});}});
const w=dom.window,d=w.document;
const errs=[];w.addEventListener('error',e=>errs.push(e.message));
const dec=u=>{const m=(u||'').match(/\/cfg\/([A-Za-z0-9_-]+)\//);return m?JSON.parse(Buffer.from(m[1],'base64url').toString('utf8')):null;};
setTimeout(()=>{try{
  const C=w.__cfg;let bad=0;const A=(t,c)=>{if(!c)bad++;console.log((c?'✓':'✗')+' '+t);};
  const out=()=>d.getElementById('url').value;
  const chips=id=>[...d.querySelectorAll('#'+id+' .chips')];
  const byTxt=(row,txt)=>[...row.querySelectorAll('.chip')].find(c=>c.textContent===txt);
  let c,o;
  /* সোর্স */
  c=d.querySelectorAll('#srcGrid .card').length===10;A('সোর্স-কার্ড ১০টি',c);
  c=d.getElementById('card-peng').textContent.indexOf('Sky Movies')>=0;A('সোর্স-কার্ড: Sky Movies (Arctic-পরিবার)',c);
  /* MovieBox: রেজো ৪+All, ভাষা ১৭+All (Multi+Tagalog সহ) */
  const nxR=chips('tune-nx')[0],nxL=chips('tune-nx')[1];
  c=nxR.querySelectorAll('.chip').length===5;A('MovieBox-রেজো-চিপ All+৪ (4K/1080/720/480)',c);
  c=nxL.querySelectorAll('.chip').length===18;A('MovieBox-ভাষা-চিপ All+১৭',c);
  c=!!byTxt(nxL,'Multi')&&!!byTxt(nxL,'Tagalog');A('Multi+Tagalog-চিপ-আছে',c);
  byTxt(nxL,'Hindi').click();
  c=C.st.nxl.length===1&&C.st.nxl[0]==='hindi'&&byTxt(nxL,'Hindi').classList.contains('on');A('Hindi-টগল → nxl ["hindi"]+.on',c);
  byTxt(nxL,'Hindi').click();c=C.st.nxl.length===0;A('আবার-টগল → []',c);
  /* RareToons: এখন-রেজো+বিশাল-ভাষা-দুই-সারি */
  const rtR=chips('tune-rt')[0],rtL=chips('tune-rt')[1];
  c=rtR.querySelectorAll('.chip').length===5&&rtL.querySelectorAll('.chip').length===18;A('RareToons-রেজো All+৪ + ভাষা All+১৭',c);
  byTxt(rtL,'Tamil').click();c=C.st.rtl.length===1&&C.st.rtl[0]==='tamil';A('rtl → ["tamil"]',c);
  /* ToonWorld: 4K-সহ */
  const twR=chips('tune-tw')[0];
  byTxt(twR,'4K').click();byTxt(twR,'1080p').click();
  c=JSON.stringify(C.st.twq)==='[2160,1080]';A('twq → [2160,1080]: '+JSON.stringify(C.st.twq),c);
  /* Multimovies: চিপ-মোড (single-cap-বাদ) */
  c=chips('tune-mm').length===2;A('MM-কার্ডে-২-চিপ-সারি (রেজো+ভাষা), একক-cap-নেই',c);
  c=d.querySelector('#tune-v .chips').classList.contains('seg');A('Subtitles-segmented',c);
  byTxt(chips('tune-mm')[0],'720p').click();
  c=JSON.stringify(C.st.mmq)==='[720]';A('mmq → [720]',c);
  /* Sky Movies: নিজস্ব-রেজো+ভাষা */
  byTxt(chips('tune-peng')[0],'4K').click();byTxt(chips('tune-peng')[1],'Hindi').click();
  c=JSON.stringify(C.st.pengq)==='[2160]'&&JSON.stringify(C.st.pengl)==='["hindi"]';A('pengq [2160]+pengl ["hindi"]',c);
  /* লুকানো-ফিল্টার: fzone-ডিফল্টে-লুকানো, Filters-বাটনে-খোলে */
  const disp=e=>w.getComputedStyle(e).display;
  const op=e=>{const v=w.getComputedStyle(e).opacity;return v===''?null:v;};
  c=d.getElementById('tune-nx').classList.contains('open')===false&&(op(d.querySelector('#tune-nx .fzone'))!==null?op(d.querySelector('#tune-nx .fzone'))==='0':disp(d.querySelector('#tune-nx .fzone'))!=='none');A('Tune-ফিল্টার-ডিফল্টে-লুকানো (0fr+opacity0)',c);
  d.querySelector('#tune-nx .fbtn').click();
  c=d.getElementById('tune-nx').classList.contains('open')&&(op(d.querySelector('#tune-nx .fzone'))===null||op(d.querySelector('#tune-nx .fzone'))==='1');A('Filters-বাটনে-মসৃণ-খোলে (1fr+opacity1)',c);
  const fgx=d.querySelectorAll('#tune-nx .fgroup');
  c=fgx.length===2;A('MovieBox-২-ফিল্টার-গ্রুপ (রেজো+ভাষা)',c);
  c=fgx[0].querySelector('.chips').classList.contains('seg')&&!fgx[1].querySelector('.chips').classList.contains('seg');A('রেজো=segmented, ভাষা=chip-গ্রুপ',c);
  byTxt(chips('tune-nx')[1],'Hindi').click();
  c=fgx[1].classList.contains('filtered')&&fgx[1].querySelector('.fcnt').textContent==='1 selected';A('গ্রুপ-হেডারে-গণনা (1 selected)',c);
  fgx[1].querySelector('.fclr').click();
  c=C.st.nxl.length===0&&fgx[1].querySelector('.fcnt').textContent==='All'&&!fgx[1].classList.contains('filtered');A('Clear-এক-ট্যাপে-খালি',c);
  byTxt(chips('tune-nx')[1],'Hindi').click();byTxt(chips('tune-nx')[1],'Hindi').click(); /* পরের-টেস্টের-জন্য-আবার-নিস্ক্রিয় */
  /* Servers: গ্রুপ-কার্ডে-লুকানো */
  c=d.getElementById('srvCard')&&d.getElementById('srvGrid')&&d.getElementById('srvCard').classList.contains('open')===false;A('Servers-গ্রিড-ডিফল্টে-লুকানো (open-শ্রেণি-নেই)',c);
  d.getElementById('srvTgl').click();
  c=d.getElementById('srvCard').classList.contains('open')&&d.getElementById('srvCard').querySelector('.finner .srvgrid').children.length===16;A('Show-বাটনে-সার্ভার-দৃশ্যমান (১৬-টাইল)',c);
  /* v1.15.81: "None" আর st.srv=[] নয় (সার্ভার-চুক্তিতে খালি=সব-১৬) — এখন সত্যিই ফ্লিট-বন্ধ */
  d.getElementById('srvNone').click();c=C.st.v===0&&d.getElementById('card-v').classList.contains('off');A('srvNone → Vidy-ফ্লিট-বন্ধ (v=0)',c);
  d.getElementById('sw-v').click();c=C.st.v===1;A('পুনঃ-চালু → v=1',c);
  d.getElementById('srvPri').click();c=C.st.srv.length===3;A('srvPri → ৩',c);
  d.getElementById('srvAll').click();c=C.st.srv.length===16;A('srvAll → ১৬',c);
  /* v1.15.81: বুটে-সার্ভার-টাইল-রিড্র (আগে প্রথম-লোডে কোনো-টাইলেই .on থাকত-না) */
  c=d.querySelectorAll('#srvGrid .srv.on').length===16;A('বুটে ১৬-সার্ভার-টাইল .on',c);
  c=d.querySelectorAll('#rtGrid .srv.on').length===2;A('বুটে RT-দুই-টাইল .on',c);
  c=d.getElementById('rtSum2').textContent.indexOf('2 of 2')===0;A('rtSum2 "2 of 2 servers on — MQ + Pixeldrain": '+d.getElementById('rtSum2').textContent,c);
  c=d.getElementById('bdSrv').textContent==='16/16';A('bdSrv 16/16: '+d.getElementById('bdSrv').textContent,c);
  /* v1.15.81: flab-লেবেলে আক্ষরিক <em> নেই */
  c=d.querySelector('#tune-v .flab').innerHTML.indexOf('<em>')>0&&d.querySelector('#tune-v .flab').textContent.indexOf('<em>')<0;
  A('flab-<em>-সঠিক-রেন্ডার (আক্ষরিক-ট্যাগ-নেই): '+d.querySelector('#tune-v .flab').textContent,c);
  c=d.getElementById('rtCard')!==null&&d.querySelectorAll('#rtGrid .srv').length===2;A('Servers: RareToons-গ্রুপ+২-সার্ভার-টাইল',c);
  c=d.getElementById('rtCard').classList.contains('open')===false;A('RT-গ্রুপ-ডিফল্টে-লুকানো',c);
  d.getElementById('rtTgl').click();
  d.querySelector('#rtGrid .srv[data-k=mq]').click();
  c=JSON.stringify(C.st.rtsrv)==='["mq"]';A('MQ-টগল-অফ → rtsrv ["mq"] (বাদ-তালিকা)',c);
  C.rebuild();o=dec(out());
  c=!!o&&JSON.stringify(o.rtsrv)==='["mq"]';A('ব্লবে-rtsrv-নির্গমন: '+JSON.stringify(o),c);
  d.querySelector('#rtGrid .srv[data-k=mq]').click();
  c=C.st.rtsrv.length===0&&!((o=dec(out()))&&('rtsrv'in o));A('পুনঃটগল → rtsrv-বাদ (দুটোই-অন)',c);
  /* v1.15.81: দুটোই-বাদ → সারাংশ "0 of 2", ব্লবে ২-মান, RT-প্রিভিউ-লুকানো */
  d.querySelector('#rtGrid .srv[data-k=mq]').click();d.querySelector('#rtGrid .srv[data-k=pd]').click();
  c=JSON.stringify(C.st.rtsrv.sort())==='["mq","pd"]';A('দুটোই-বাদ → rtsrv [mq,pd]',c);
  c=d.getElementById('rtSum2').textContent.indexOf('0 of 2')===0;A('rtSum2 "0 of 2 …": '+d.getElementById('rtSum2').textContent,c);
  C.rebuild();o=dec(out());
  c=!!o&&JSON.stringify((o.rtsrv||[]).sort())==='["mq","pd"]';A('ব্লবে-দুটোই-বাদ-নির্গমন: '+JSON.stringify(o),c);
  c=d.getElementById('pvR').style.display==='none';A('দুটো-বাদ → RT-প্রিভিউ-লুকানো',c);
  d.querySelector('#rtGrid .srv[data-k=pd]').click();c=JSON.stringify(C.st.rtsrv)==='["mq"]';A('pd-পুনরায়-অন → rtsrv [mq]',c);
  d.querySelector('#rtGrid .srv[data-k=mq]').click();c=C.st.rtsrv.length===0;A('সব-পুনরায়-অন',c);
  /* v1.15.81: Reset-এ চিপ-রিড্র (আগে স্টেট-পরিষ্কার+UI-পুরনো) */
  byTxt(chips('tune-nx')[1],'Hindi').click();byTxt(chips('tune-m4u')[0],'4K').click();
  c=C.st.nxl.length===1&&C.st.m4uq.length===1;A('Reset-আগে-চিপ-নির্বাচিত',c);
  d.getElementById('tab-srv');d.getElementById('srvTgl').click();d.getElementById('rtTgl').click();
  d.getElementById('rst').click();
  c=C.st.nxl.length===0&&C.st.m4uq.length===0;A('Reset → স্টেট-পরিষ্কার',c);
  c=!byTxt(chips('tune-nx')[1],'Hindi').classList.contains('on');A('Reset → ভাষা-চিপ-দৃশ্যত-পরিষ্কার',c);
  c=!byTxt(chips('tune-m4u')[0],'4K').classList.contains('on');A('Reset → রেজো-চিপ-দৃশ্যত-পরিষ্কার',c);
  c=d.querySelectorAll('#tune-nx .fgroup.filtered').length===0&&d.querySelector('#tune-nx .fcnt').textContent==='All';A('Reset → গ্রুপ-গণনা "All"',c);
  c=!d.getElementById('srvCard').classList.contains('open')&&d.getElementById('srvTgl').textContent.indexOf('Show')===0;A('Reset → সার্ভার-কার্ড-গোটানো+লেবেল-সিঙ্ক',c);
  /* v1.15.81: Sky-প্রিভিউ আর Movies4u-র m4ur-দেখায়-না */
  C.st.m4ur=480;C.st.pengq=[];C.rebuild();
  c=d.getElementById('pvPq').textContent==='All'&&d.getElementById('pvPh').textContent.indexOf('2160')>0;A('Sky-প্রিভিউ m4ur-মুক্ত (All/2160): '+d.getElementById('pvPq').textContent+' / '+d.getElementById('pvPh').textContent,c);
  C.st.m4ur=0;
  /* rebuild-চুক্তি */
  const rst=()=>{C.st.q=[];C.st.sub=1;C.st.srv=[];C.st.az=1;C.st.azq=[];C.st.azl=[];C.st.nx=1;C.st.nxq=[];C.st.nxl=[];C.st.rt=1;C.st.rtl=[];C.st.rtq=[];C.st.tw=1;C.st.twq=[];C.st.twl=[];C.st.mm=1;C.st.mmr=0;C.st.mmq=[];C.st.mml=[];C.st.m4u=1;C.st.m4ur=0;C.st.m4uq=[];C.st.m4ul=[];C.st.peng=1;C.st.pengq=[];C.st.pengl=[];C.st.vsp=1;C.st.vspq=[];C.st.vspl=[];C.st.ott=1;C.st.ottq=[];C.st.ottl=[];};
  rst();C.rebuild();
  c=!/\/cfg\//.test(out());A('সব-ডিফল্ট → ব্লব-বিহীন',c);
  C.st.az=0;C.rebuild();o=dec(out());
  c=!!o&&Object.keys(o).length===1&&o.az===0;A('az=0 → {"az":0}: '+JSON.stringify(o),c);
  C.st.az=1;C.st.mm=1;C.st.mmq=[720,2160];C.st.twq=[480];C.rebuild();o=dec(out());
  c=!!o&&JSON.stringify(o.mmq)==='[2160,720]'&&JSON.stringify(o.twq)==='[480]';A('mmq-desc+twq-সহাবস্থান: '+JSON.stringify(o),c);
  C.st.peng=1;C.st.pengq=[2160];C.st.pengl=['hindi'];C.rebuild();o=dec(out());
  c=!!o&&JSON.stringify(o.pengq)==='[2160]'&&JSON.stringify(o.pengl)==='["hindi"]';A('pengq+pengl-নির্গমন: '+JSON.stringify(o),c);
  C.st.srv=C.SRVS.map(s=>s[0]);C.rebuild();o=dec(out());
  c=!!o&&!('srv'in o);A('srv-সব → বাদ',c);
  /* preview-সততা */
  C.st.mm=1;C.st.mmq=[480];C.rebuild();
  c=d.getElementById('pvMq').textContent.indexOf('≤480p')>=0;A('pvMq ≤480p: '+d.getElementById('pvMq').textContent,c);
  C.st.twq=[2160];C.st.azl=['hindi'];C.rebuild();
  c=d.getElementById('pvTh').textContent.indexOf('2160')>=0;A('pvTh 2160',c);
  c=d.getElementById('pvAt').textContent.indexOf('Hindi')>=0;A('pvAt Hindi: '+d.getElementById('pvAt').textContent.split('\n')[2],c);
  c=d.getElementById('pvP').style.display!=='none'&&d.getElementById('pvPt').textContent.indexOf('Sky Movies')>=0;A('pvP Sky Movies-দৃশ্যমান',c);
  C.st.rtl=['tamil','hindi','telugu'];C.st.rtq=[];C.rebuild();
  c=d.getElementById('pvRh').textContent==='\u25a5 1080 \u25a5';A('pvRh-হেডার ▥ 1080 ▥ (Auto-বাদ): '+d.getElementById('pvRh').textContent,c);
  c=d.getElementById('pvRq').textContent==='Tamil +2';A('pvRq-সংক্ষিপ্ত (Tamil +2): '+d.getElementById('pvRq').textContent,c);
  C.st.rtl=['hindi'];C.rebuild();
  c=d.getElementById('pvRq').textContent==='Hindi';A('pvRq-একক (Hindi): '+d.getElementById('pvRq').textContent,c);
  C.st.rtq=[720];C.st.rtl=[];C.rebuild();
  c=d.getElementById('pvRq').textContent==='≤720p';A('pvRq-রেজো (≤720p): '+d.getElementById('pvRq').textContent,c);C.st.rtq=[];
  /* hydrate: legacy + নতুন */
  const blob1=Buffer.from(JSON.stringify({twq:[1080],mmr:480,az:0})).toString('base64url');
  const d2=new JSDOM(html,{runScripts:'dangerously',url:'http://127.0.0.1:7000/cfg/'+blob1+'/configure',beforeParse(w2){w2.fetch=()=>Promise.resolve({ok:false});}});
  setTimeout(()=>{try{
    const C2=d2.window.__cfg,u2=d2.window.document.getElementById('url').value;
    let b2=0;const A2=(t,cc)=>{if(!cc)b2++;console.log((cc?'✓':'✗')+' '+t);};
    A2('hydrate-legacy: twq1080/mmr480/az0',C2.st.twq[0]===1080&&C2.st.mmr===480&&C2.st.az===0);
    const o2=dec(u2);
    A2('legacy-URL-অপরিবর্তিত (mmr-স্থায়ী, mmq-নেই): '+u2,o2&&o2.mmr===480&&!('mmq'in o2)&&o2.az===0&&o2.twq&&o2.twq[0]===1080);
    const blob3=Buffer.from(JSON.stringify({mmq:[1080,480],pengl:['hindi'],rtq:[2160],rtl:['bengali']})).toString('base64url');
    const d3=new JSDOM(html,{runScripts:'dangerously',url:'http://127.0.0.1:7000/cfg/'+blob3+'/configure',beforeParse(w3){w3.fetch=()=>Promise.resolve({ok:false});}});
    setTimeout(()=>{try{
      const C3=d3.window.__cfg,u3=d3.window.document.getElementById('url').value,o3=dec(u3);
      let b3=0;const A3=(t,cc)=>{if(!cc)b3++;console.log((cc?'✓':'✗')+' '+t);};const A4=A3;let b4=0;
      A3('hydrate-নতুন: mmq/pengl/rtq/rtl(bengali-লিগ্যাসি)',JSON.stringify(C3.st.mmq)==='[1080,480]'&&C3.st.pengl[0]==='hindi'&&C3.st.rtq[0]===2160&&C3.st.rtl[0]==='bengali');
      A3('নতুন-URL-রাউন্ডট্রিপ: '+u3,o3&&JSON.stringify(o3.mmq)==='[1080,480]'&&JSON.stringify(o3.pengl)==='["hindi"]'&&o3.rtq[0]===2160&&o3.rtl[0]==='bengali');
      /* mmq-নির্বাচিত-হলে-legacy-mmr-পুরোপুরি-বাদ */
      const d4=new JSDOM(html,{runScripts:'dangerously',url:'http://127.0.0.1:7000/cfg/'+Buffer.from(JSON.stringify({mmr:720,m4ur:720})).toString('base64url')+'/configure',beforeParse(w4){w4.fetch=()=>Promise.resolve({ok:false});}});
      setTimeout(()=>{try{
        const C4=d4.window.__cfg;
        C4.st.mmq=[480];C4.rebuild();
        const o4=dec(d4.window.document.getElementById('url').value);
        A4('mmq-টোকা-লেগে-mmr-বাদ (m4ur-অক্ষত): '+JSON.stringify(o4),o4&&o4.mmq[0]===480&&!('mmr'in o4)&&o4.m4ur===720);if(b4)b3+=b4;
        if(errs.length)A4('window-errors: '+errs.join(' | '),false);
        console.log(bad||b2||b3?('--- ব্যর্থ মোট '+(bad+b2+b3)+' ---'):'--- সব-সবুজ ---');
        process.exitCode=(bad||b2||b3)?1:0;
      }catch(e){console.error('FAIL4:',e.stack);process.exitCode=1;}},350);
    }catch(e){console.error('FAIL3:',e.stack);process.exitCode=1;}},350);
  }catch(e){console.error('FAIL2:',e.stack);process.exitCode=1;}},350);
}catch(e){console.error('FAIL:',e.stack);process.exitCode=1;}},400);
