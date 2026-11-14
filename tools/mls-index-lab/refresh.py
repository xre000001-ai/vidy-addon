#!/usr/bin/env python3
"""Resumable modified-time sweep; never advances high-water mark on failure."""
import argparse, datetime, json, random, sqlite3, subprocess, time
from urllib.parse import urlencode
from indexer import savepost
FMT='%Y-%m-%dT%H:%M:%S'
def main():
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--proxy-list',required=True);p.add_argument('--max-pages',type=int,default=10);a=p.parse_args()
 proxies=[x['proxy'] for x in json.load(open(a.proxy_list))['good']];db=sqlite3.connect(a.db)
 db.executescript('CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT); CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT);')
 def get(k):
  r=db.execute('SELECT v FROM state WHERE k=?',(k,)).fetchone();return r[0] if r else None
 def put(k,v):db.execute('INSERT OR REPLACE INTO state VALUES(?,?)',(k,str(v)))
 cut=get('refresh_cut');start=get('refresh_from');page=int(get('refresh_page') or '1')
 if not cut:
  now=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)-datetime.timedelta(minutes=5)
  prev=get('refresh_watermark');start=((datetime.datetime.strptime(prev,FMT) if prev else now-datetime.timedelta(days=7))-datetime.timedelta(days=2)).strftime(FMT);cut=now.strftime(FMT);page=1
  with db:put('refresh_from',start);put('refresh_cut',cut);put('refresh_page',1)
 print('refresh range',start,'to',cut,'page',page,flush=True)
 for _ in range(max(0,a.max_pages)):
  q={'per_page':100,'page':page,'orderby':'modified','order':'asc','modified_after':start,'modified_before':cut,'_fields':'id,title,link,date,modified,content'};url='https://mlsbd.co/wp-json/wp/v2/posts?'+urlencode(q);result=None
  for proxy in random.sample(proxies,min(12,len(proxies))):
   try:
    r=subprocess.run(['curl','-sS','--connect-timeout','5','--max-time','18','--proxy',proxy,'-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','-H','Accept: application/json','-w','\n%{http_code}',url],capture_output=True,text=True,timeout=20)
    body,status=r.stdout.rsplit('\n',1);j=json.loads(body)
    if status=='400' and page>1 and isinstance(j,dict) and j.get('code')=='rest_post_invalid_page_number':result=[];break
    if status!='200' or not isinstance(j,list) or any(not isinstance(x,dict) or not x.get('id') or not isinstance(x.get('content'),dict) or not x.get('link') or not isinstance(x.get('title'),dict) for x in j):continue
    result=j;break
   except Exception:pass
  if result is None:print('refresh failed page',page,'watermark preserved',flush=True);break
  with db:
   for post in result:savepost(db,post)
   if len(result)<100:
    put('refresh_watermark',cut);db.execute("DELETE FROM state WHERE k IN ('refresh_from','refresh_cut','refresh_page')")
   else:put('refresh_page',page+1)
  print('refresh page',page,'rows',len(result),flush=True)
  if len(result)<100:print('refresh completed',cut,flush=True);break
  page+=1
 db.close()
if __name__=='__main__':main()
