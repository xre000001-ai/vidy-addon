#!/usr/bin/env python3
"""Export compact sharded metadata, never final video URLs; experimental only."""
import argparse, datetime, json, pathlib, sqlite3, os
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--output',required=True);a=p.parse_args()
c=sqlite3.connect('file:'+os.path.abspath(a.db)+'?mode=ro',uri=True);dest=pathlib.Path(a.output);dest.mkdir(parents=True,exist_ok=True)
shards=[[] for _ in range(16)]; bad=0
try:other={id:json.loads(links) for id,links in c.execute('SELECT id,links FROM post_other')}
except sqlite3.OperationalError:other={}
for id,title,url,date,modified,links in c.execute('SELECT id,title,url,date,modified,links FROM posts'):
 try:
  sav=json.loads(links)
  if not isinstance(sav,list) or not id or not title or not url.startswith('https://mlsbd.co/'):raise ValueError('invalid record')
  shards[id%16].append({'id':id,'title':title,'url':url,'date':date,'modified':modified,'sav':[{'id':x['id'],'q':x.get('quality',0),'ep':x.get('episode',0)} for x in sav if x.get('id')],'other':other.get(id,[])})
 except Exception:bad+=1
if bad:raise SystemExit('REFUSE EXPORT invalid records: '+str(bad))
if sum(map(len,shards))<1:raise SystemExit('REFUSE EXPORT empty index')
for i,rows in enumerate(shards):
 rows.sort(key=lambda x:x['id']);p=dest/('s%02d.json'%i);t=p.with_suffix('.tmp');t.write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')));os.replace(t,p)
mirrors={}
try:
 for ident,body,checked in c.execute('SELECT id,data,checked FROM mirrors'):
  links=json.loads(body)
  # Do not publish expiring query strings or direct media candidates.
  urls=[x['url'] for x in links if isinstance(x,dict) and x.get('url','').startswith('https://') and '?' not in x['url'] and '#' not in x['url']]
  if urls:mirrors[ident]={'checked':checked,'pages':urls}
except sqlite3.OperationalError:pass
(dest/'mirrors.json').write_text(json.dumps(mirrors,ensure_ascii=False,separators=(',',':')))
manifest={'schema':1,'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'posts':sum(map(len,shards)),'savelinks':sum(len(r['sav']) for a in shards for r in a),'mirror_sets':len(mirrors),'shards':[{'file':'s%02d.json'%i,'posts':len(rows)} for i,rows in enumerate(shards)]}
try:manifest['successful_pages']=c.execute('SELECT count(*) FROM pages').fetchone()[0]
except sqlite3.OperationalError:pass
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));print(json.dumps(manifest,ensure_ascii=False))
