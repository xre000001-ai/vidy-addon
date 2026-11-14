#!/usr/bin/env python3
"""Experimental resumable MLSBD metadata/mirror-page index, not addon integration."""
import argparse, concurrent.futures, datetime, html, json, re, sqlite3, time, subprocess, itertools
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urlencode
import requests
BASE='https://mlsbd.co'; READER='https://r.jina.ai/'
class Links(HTMLParser):
 def __init__(self): super().__init__(); self.links=[]; self.text=''; self.cur=None
 def handle_starttag(self,tag,attrs):
  if tag=='a':
   a=dict(attrs); self.cur={'url':html.unescape(a.get('href','')),'label':'','context':self.text[-400:]}
 def handle_data(self,data):
  self.text=(self.text+' '+data)[-1000:]
  if self.cur is not None:self.cur['label']+=data
 def handle_endtag(self,tag):
  if tag=='a' and self.cur is not None:
   self.cur['label']=' '.join(self.cur['label'].split());self.links.append(self.cur);self.cur=None

def extract_post(body):
 p=Links();p.feed(body or ''); out=[]
 for a in p.links:
  m=re.search(r'https?://(?:www\.)?savelinks\.me/view/([A-Za-z0-9]+)',a['url'],re.I)
  if not m:continue
  t=a['label']; q=re.search(r'\b(2160|1080|720|480|360)\s*p?\b|\b(4k|uhd)\b',t,re.I)
  em=list(re.finditer(r'(?<![A-Za-z0-9])(?:episode|epi|ep|e)\s*[-_.: ]?\s*0*(\d{1,3})(?![A-Za-z0-9])',a['context'],re.I))
  out.append({'id':m.group(1),'url':'https://savelinks.me/view/'+m.group(1),'label':t,'quality':(int(q.group(1)) if q and q.group(1) else 2160 if q else 0),'episode':int(em[-1].group(1)) if em else 0})
 return list({x['id']:x for x in out}.values())

def mirror_links(body):
 p=Links();p.feed(body or '');out=[]
 for a in p.links:
  u=urljoin('https://savelinks.me/',a['url']);h=(urlparse(u).hostname or '').lower()
  if re.search(r'(^|\.)(?:gdflix\.[a-z.]+|gdlink\.[a-z.]+|ddflix\.[a-z.]+|multicloudlinks\.[a-z.]+|multidownload\.[a-z.]+|fsldownload\.[a-z.]+|filepress\.[a-z.]+|pixeldrain\.com)$',h):out.append({'url':u,'label':a['label'][:180]})
 return list({x['url']:x for x in out}.values())

PROXIES=[]
TURN=0

def wp(page,before=None):
 global TURN
 q={'per_page':100,'page':page,'_fields':'id,title,link,date,modified,content'}
 if before:q['before']=before
 url=BASE+'/wp-json/wp/v2/posts?'+urlencode(q)
 errors=[]
 # Free proxies are untrusted and ephemeral; only public metadata is requested.
 for i in range(min(15,len(PROXIES))):
  proxy=PROXIES[(TURN+i)%len(PROXIES)]
  try:
   r=subprocess.run(['curl','-fsS','--connect-timeout','6','--max-time','20','--proxy',proxy,'-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','-H','Accept: application/json',url],capture_output=True,text=True,timeout=22)
   if r.returncode:raise ValueError('proxy fetch failed')
   j=json.loads(r.stdout)
   if not isinstance(j,list) or not j or any(not isinstance(x,dict) or not x.get('id') or not isinstance(x.get('content'),dict) for x in j):raise ValueError('invalid upstream result')
   TURN=(TURN+i+1)%len(PROXIES);return j
  except Exception as e:errors.append(type(e).__name__)
 if PROXIES:raise RuntimeError('no valid proxy response: '+','.join(errors))
 r=requests.get(READER+url,timeout=40);r.raise_for_status();j=json.loads(r.text.split('Markdown Content:',1)[-1].strip())
 if not isinstance(j,list) or not j or any(not isinstance(x,dict) or not x.get('id') or not isinstance(x.get('content'),dict) for x in j):raise ValueError('invalid or empty upstream result')
 return j

def savepost(db,p):
 title=html.unescape(p.get('title',{}).get('rendered',''));links=extract_post(p['content'].get('rendered',''))
 if not p.get('link') or not title:raise ValueError('invalid post')
 db.execute('INSERT INTO posts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,date=excluded.date,modified=excluded.modified,links=excluded.links',(p['id'],title,p['link'],p.get('date',''),p.get('modified',''),json.dumps(links,ensure_ascii=False)))

def fetchmirror(id):
 r=requests.get('https://savelinks.me/view/'+id,headers={'Referer':BASE+'/'},timeout=16);r.raise_for_status()
 if len(r.text)<1000 or re.search(r'just a moment|checking your browser|bots not allowed',r.text,re.I):raise ValueError('challenge or incomplete page')
 return mirror_links(r.text)

def main():
 global PROXIES
 ap=argparse.ArgumentParser();ap.add_argument('--db',default='index.sqlite');ap.add_argument('--pages',type=int,default=2);ap.add_argument('--mirror-limit',type=int,default=10);ap.add_argument('--proxy-list');a=ap.parse_args()
 if a.proxy_list:
  data=json.load(open(a.proxy_list));PROXIES=[x['proxy'] for x in sorted(data['good'],key=lambda x:x['ms'])]
 db=sqlite3.connect(a.db);db.executescript('CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT); CREATE TABLE IF NOT EXISTS mirrors(id TEXT PRIMARY KEY, data TEXT, checked INTEGER); CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT);')
 def state(k):
  x=db.execute('SELECT v FROM state WHERE k=?',(k,)).fetchone();return x[0] if x else None
 def setstate(k,v):db.execute('INSERT OR REPLACE INTO state VALUES(?,?)',(k,str(v)))
 if not state('before'):setstate('before',datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'));setstate('next_page',1);db.commit()
 for p,cut in [(1,None)]+[(int(state('next_page'))+i,state('before')) for i in range(a.pages)]:
  try:
   data=wp(p,cut)
   with db:
    for post in data:savepost(db,post)
    if cut:setstate('next_page',p+1)
   print('wp',p,'backfill' if cut else 'latest',len(data),flush=True)
  except Exception as e:
   print('wp FAILED',p,type(e).__name__,str(e)[:200],flush=True)
   if cut:break
 ids=[]
 for (links,) in db.execute('SELECT links FROM posts ORDER BY date DESC'):
  for l in json.loads(links):
   hit=db.execute('SELECT checked FROM mirrors WHERE id=?',(l['id'],)).fetchone()
   if not hit or time.time()-hit[0]>86400:ids.append(l['id'])
 ids=list(dict.fromkeys(ids))[:max(0,a.mirror_limit)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  futures={pool.submit(fetchmirror,x):x for x in ids}
  for f in concurrent.futures.as_completed(futures):
   id=futures[f]
   try:
    links=f.result()
    if links:
     with db:db.execute('INSERT OR REPLACE INTO mirrors VALUES(?,?,?)',(id,json.dumps(links,ensure_ascii=False),int(time.time())))
    print('mirror',id,len(links),flush=True)
   except Exception as e:print('mirror FAILED',id,type(e).__name__,flush=True)
 print('totals posts',db.execute('SELECT COUNT(*) FROM posts').fetchone()[0],'mirrors',db.execute('SELECT COUNT(*) FROM mirrors').fetchone()[0],'next_page',state('next_page'),'before',state('before'),flush=True);db.close()
if __name__=='__main__':main()
