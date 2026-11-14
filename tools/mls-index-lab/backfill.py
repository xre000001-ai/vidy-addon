#!/usr/bin/env python3
"""Bounded parallel, resumable *experimental* MLSBD backfill. No publishing."""
import argparse, concurrent.futures, datetime, json, random, sqlite3, subprocess, time
from urllib.parse import urlencode
from indexer import savepost

def main():
 a=argparse.ArgumentParser();a.add_argument('--db',default='backfill.sqlite');a.add_argument('--proxy-list',default='bd-results.json');a.add_argument('--start',type=int,default=1);a.add_argument('--end',type=int,default=350);a.add_argument('--workers',type=int,default=4);a.add_argument('--max-pages',type=int,default=0);a=a.parse_args()
 proxies=[x['proxy'] for x in json.load(open(a.proxy_list))['good']];db=sqlite3.connect(a.db)
 db.executescript('CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT); CREATE TABLE IF NOT EXISTS pages(page INTEGER PRIMARY KEY,checked INTEGER,rows INTEGER); CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE IF NOT EXISTS attempts(page INTEGER PRIMARY KEY, checked INTEGER);')
 cut=db.execute("select v from state where k='before'").fetchone()
 if not cut:
  cut=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S');db.execute("insert into state values('before',?)",(cut,));db.commit()
 else:cut=cut[0]
 done={x[0] for x in db.execute('select page from pages')};attempts=dict(db.execute('select page,checked from attempts'));pages=[p for p in range(a.start,a.end+1) if p not in done];pages.sort(key=lambda p:(attempts.get(p,0),p))
 if a.max_pages:pages=pages[:a.max_pages]
 print('snapshot',cut,'queued',len(pages),'stored pages',len(done),flush=True)
 def fetch(p):
  q={'per_page':100,'page':p,'_fields':'id,title,link,date,modified,content','before':cut};url='https://mlsbd.co/wp-json/wp/v2/posts?'+urlencode(q)
  for px in random.sample(proxies,min(5,len(proxies))):
   try:
    r=subprocess.run(['curl','-fsS','--connect-timeout','5','--max-time','15','--proxy',px,'-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','-H','Accept: application/json',url],capture_output=True,text=True,timeout=17)
    if r.returncode:continue
    j=json.loads(r.stdout)
    if not isinstance(j,list) or not j or any(not isinstance(x,dict) or not x.get('id') or not isinstance(x.get('content'),dict) or not x.get('link') or not (x.get('title') or {}).get('rendered') for x in j):continue
    return p,j
   except Exception:pass
  return p,None
 fail=[];started=time.time()
 with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(8,a.workers))) as ex:
  for n,(page,rows) in enumerate(ex.map(fetch,pages),1):
   if rows:
    try:
     with db:
      for p in rows:savepost(db,p)
      db.execute('INSERT OR REPLACE INTO pages VALUES(?,?,?)',(page,int(time.time()),len(rows)))
    except Exception as e:fail.append(page);print('db-error',page,type(e).__name__,flush=True)
   else:fail.append(page)
   with db:db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?)',(page,int(time.time())))
   if n%10==0 or n==len(pages):print('done',n,'/',len(pages),'success',n-len(fail),'fail',len(fail),'posts',db.execute('select count(*) from posts').fetchone()[0],'seconds',int(time.time()-started),flush=True)
 print('failed pages',fail,flush=True);db.close()
if __name__=='__main__':main()
