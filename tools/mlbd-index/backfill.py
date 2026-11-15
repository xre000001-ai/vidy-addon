#!/usr/bin/env python3
"""Experimental resume-safe MovieLinkBD reference backfill; no media URLs saved."""
import argparse,email.utils,html,json,random,re,sqlite3,subprocess,time,datetime
from pathlib import Path
from urllib.parse import urlparse
import requests
from claim import claim
D=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--db',default=str(D/'sample-index.sqlite'));p.add_argument('--limit',type=int,default=120);p.add_argument('--delay',type=float,default=1.5);args=p.parse_args()
db=sqlite3.connect(args.db,timeout=30);db.execute('pragma foreign_keys=ON');db.executescript('''
CREATE TABLE IF NOT EXISTS jobs(kind TEXT NOT NULL,path TEXT NOT NULL,post_id INTEGER NOT NULL,depth INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_status TEXT,last_try INTEGER,PRIMARY KEY(kind,path,post_id));
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,kind,attempts);
CREATE TABLE IF NOT EXISTS server_refs(ref_id INTEGER NOT NULL REFERENCES refs(id),kind TEXT NOT NULL,url TEXT NOT NULL,depth INTEGER NOT NULL DEFAULT 0,seen_at INTEGER NOT NULL,PRIMARY KEY(ref_id,kind,url));
CREATE TABLE IF NOT EXISTS file_jobs(path TEXT NOT NULL,ref_id INTEGER NOT NULL REFERENCES refs(id),depth INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_status TEXT,last_try INTEGER,PRIMARY KEY(path,ref_id));
CREATE INDEX IF NOT EXISTS file_jobs_pending ON file_jobs(state,attempts,depth);
''')
with db:
 db.execute("INSERT OR IGNORE INTO jobs(kind,path,post_id) SELECT 'title',path,id FROM posts")
 db.execute("INSERT OR IGNORE INTO file_jobs(path,ref_id,depth) SELECT path,id,0 FROM refs")
s=requests.Session();s.headers.update({'User-Agent':'MovieLinkBDIndexResearch/0.1 (reference-only; slow crawler)','Accept':'text/html,application/xhtml+xml'})
seed=s.get('https://movielinkbd.com/',timeout=10,allow_redirects=False)
if seed.status_code!=200:raise SystemExit('Mirror discovery failed; preserve last good index')
mirrors=re.findall(r'https://[a-z0-9]{4,12}\.movielinkbd\.[a-z]{2,6}',seed.text,re.I)
if not mirrors:raise SystemExit('No declared mirror; preserve last good index')
base=mirrors[0];print('declared mirror',base,flush=True);next_at=0

def fetch(path):
 global next_at
 for hop in range(4):
  if not re.fullmatch(r'/(?:movie|series|anime|drama|file)/[A-Za-z0-9_-]+',path):return None,'unsafe-path'
  wait=next_at-time.monotonic()
  if wait>0:time.sleep(wait)
  try:
   r=s.get(base+path,timeout=12,allow_redirects=False);next_at=time.monotonic()+max(1,args.delay)
   if r.status_code in (429,503):
    print('server rate-limited',r.status_code,'Retry-After',r.headers.get('Retry-After','not specified'),'pausing run',flush=True);return None,'rate-limit'
   if r.status_code in (301,302,303,307,308):
    from urllib.parse import urljoin
    target=urlparse(urljoin(base+path,r.headers.get('Location','')))
    if target.scheme!='https' or target.netloc!=urlparse(base).netloc or target.query or target.fragment:return None,'unsafe-redirect'
    path=target.path;continue
   if r.status_code!=200:return None,'http-'+str(r.status_code)
   body=r.text
   if len(body)<10000 or '<html' not in body.lower():return None,'invalid-html'
   return body,'ok'
  except requests.RequestException as e:
   next_at=time.monotonic()+max(1,args.delay);return None,'network-'+type(e).__name__
 return None,'redirect-limit'

def parse_title(body):
 # reuse current production parser; subprocess reads supplied HTML from local temporary file
 import tempfile,os
 f=tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',delete=False,dir=D,suffix='.tmp')
 try:
  f.write(body);f.close()
  return json.loads(subprocess.check_output(['node',str(D/'extract_offline.cjs'),f.name],timeout=8))
 finally:
  try:os.unlink(f.name)
  except OSError:pass

def server_links(body):
 # Only link-page references; no presigned, workers or direct video links.
 out=set()
 for x in re.findall(r'''(?:href|data-href)\s*=\s*["']([^"']+)["']''',body,re.I):
  x=html.unescape(x)
  if re.fullmatch(r'/file/[A-Za-z0-9_-]+',x):out.add(('file-page',x))
  elif re.fullmatch(r'https://hubcloud\.[a-z.]+/drive/[A-Za-z0-9]+/?',x,re.I):out.add(('hubcloud-page',x))
  elif re.fullmatch(r'https://instantcloud\.org/file/[A-Za-z0-9]+/?',x,re.I):out.add(('instantcloud-page',x))
 return out

for n in range(max(0,args.limit)):
 # Claim under an SQLite write lock; workers cannot take the same job.
 if (D / '.stop-rate-limit').exists():print('shared rate-limit pause',flush=True);break
 kind,job=claim(db,bool(n%2))
 if job is None:print('queue exhausted',flush=True);break
 path,ident,depth=job;body,status=fetch(path);now=int(time.time())
 table='jobs' if kind=='title' else 'file_jobs';col='post_id' if kind=='title' else 'ref_id'
 if status=='rate-limit':
  (D / '.stop-rate-limit').touch()
  with db:db.execute(f"UPDATE {table} SET state='pending',last_status=?,last_try=? WHERE path=? AND {col}=?",(status,now,path,ident))
  break
 if body is None:
  with db:db.execute(f"UPDATE {table} SET state='pending',attempts=attempts+1,last_status=?,last_try=? WHERE path=? AND {col}=?",(status,now,path,ident))
  print(n+1,kind,status,'depth',depth,flush=True);continue
 try:
  if kind=='title':
   data=parse_title(body)
   if not data['items']:raise ValueError('no-file-references')
   with db:
    lookup={}
    for x in data['items']:
     db.execute('INSERT INTO refs(post_id,path,quality,name,label,size,seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(post_id,path) DO UPDATE SET quality=excluded.quality,name=excluded.name,label=excluded.label,size=excluded.size,seen_at=excluded.seen_at',(ident,x['t'],x['q'] or None,x['name'],x['lab'],x['size'],now))
     rid=db.execute('select id from refs where post_id=? and path=?',(ident,x['t'])).fetchone()[0];lookup[x['t']]=rid
     db.execute('INSERT OR IGNORE INTO file_jobs(path,ref_id,depth) VALUES(?,?,0)',(x['t'],rid))
    for g in data['groups']:
     for t in set(g['toks']):
      if t in lookup:
       # SQLite UNIQUE treats NULL as distinct: remove old same mapping first.
       db.execute('DELETE FROM episode_refs WHERE ref_id=? AND season IS ? AND episode=?',(lookup[t],g['season'],g['episode']))
       db.execute('INSERT INTO episode_refs(ref_id,season,episode) VALUES(?,?,?)',(lookup[t],g['season'],g['episode']))
    db.execute("UPDATE jobs SET state='done',last_status='ok',last_try=? WHERE path=? AND post_id=?",(now,path,ident))
   result='refs='+str(len(data['items']))
  else:
   links=server_links(body)
   # No recognized pages can be legitimate: keep it distinct, do not call it full coverage.
   with db:
    for typ,u in links:
     if u==path:continue
     db.execute('INSERT OR REPLACE INTO server_refs(ref_id,kind,url,depth,seen_at) VALUES(?,?,?,?,?)',(ident,typ,u,depth+1,now))
     if typ=='file-page' and depth<2:db.execute('INSERT OR IGNORE INTO file_jobs(path,ref_id,depth) VALUES(?,?,?)',(u,ident,depth+1))
    db.execute("UPDATE file_jobs SET state='done',last_status=?,last_try=? WHERE path=? AND ref_id=?",('ok' if links else 'no-recognized-links',now,path,ident))
   result='server-refs='+str(len(links))
  print(n+1,kind,result,'depth',depth,flush=True)
 except Exception as e:
  with db:db.execute(f"UPDATE {table} SET state='pending',attempts=attempts+1,last_status=?,last_try=? WHERE path=? AND {col}=?",('parse-'+type(e).__name__,now,path,ident))
  print(n+1,kind,'parse-error',str(e)[:100],flush=True)
print('total posts',db.execute('select count(*) from posts').fetchone()[0], 'file refs',db.execute('select count(*) from refs').fetchone()[0], 'server refs',db.execute('select count(*) from server_refs').fetchone()[0], 'title jobs done',db.execute("select count(*) from jobs where state='done'").fetchone()[0], 'file jobs done',db.execute("select count(*) from file_jobs where state='done'").fetchone()[0],flush=True)
db.close()
