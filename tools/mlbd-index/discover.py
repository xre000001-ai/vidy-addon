"""Bounded catalog discovery; cursor saved after each successful listing page."""
import html,re,sqlite3,sys,time,requests
from pathlib import Path
from ratelimit import is_paused,pause
con=sqlite3.connect(sys.argv[1]);
if is_paused(con):print('site cooldown active; discovery paused');sys.exit(0)
s=requests.Session();s.headers['User-Agent']='Mozilla/5.0 (compatible; reference-index/0.1)'
r=s.get('https://movielinkbd.com/',timeout=12);r.raise_for_status();m=re.search(r'https://[a-z0-9]{4,12}\.movielinkbd\.[a-z]{2,6}',r.text,re.I)
if not m:raise SystemExit('no declared mirror; preserve prior snapshot')
base=m[0];cursor=con.execute("select value from state where key='listing_cursor'").fetchone();cursor=int(cursor[0]) if cursor else 1
pat=re.compile(r'href="([^" ]*/(movie|series|anime|drama)/([A-Za-z0-9_-]{10,}))"[^>]*>([\s\S]{0,600}?)</a>',re.I)
# Recent pages overlap on every run; the remainder advances durably. No unsupported claim of complete traversal.
pages=list(dict.fromkeys([1,2,3]+list(range(cursor,cursor+100))))
for page in pages:
 try:
  r=s.get(base+'/new',params={'page':page},timeout=15,allow_redirects=False)
  if r.status_code in (429,503):
   print('rate-limited; preserving cursor; cooldown until',pause(con,r.headers.get('Retry-After')));break
  if r.status_code!=200 or len(r.content)<20000:print('listing error',page,r.status_code);break
  found=[]
  for z in pat.finditer(r.text):
   t=re.search(r'mlbd-lm-title">([^<]+)',z[4]) or re.search(r'alt="([^"]+)',z[4])
   if t:
    title=html.unescape(t[1]).strip();year=re.search(r'\b(19\d\d|20\d\d)\b',title)
    found.append(('/'+z[2]+'/'+z[3],title,'movie' if z[2].lower()=='movie' else 'series',int(year[1]) if year else None))
  if not found:print('no parsed items; stop without moving cursor',page);break
  with con:
   con.executemany('INSERT OR IGNORE INTO posts(path,title,type,year) VALUES(?,?,?,?)',found)
   if page>=cursor:con.execute("INSERT INTO state(key,value) VALUES('listing_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(str(page+1),))
  print('page',page,'found',len(found),'posts',con.execute('select count(*) from posts').fetchone()[0],flush=True)
  # 12 or fewer recurring pinned entries means possible end, not proof. Pause for review rather than go unbounded.
  if page>=cursor and page>50 and len(found)<=12:
   with con:con.execute("INSERT INTO state(key,value) VALUES('listing_boundary',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(str(page),))
   print('possible pinned-only boundary; requires verification',page,flush=True);break
  time.sleep(1)
 except requests.RequestException as e:print('listing network failure',type(e).__name__);break
con.close()
