"""Initialize durable reference-only MovieLinkBD database."""
import json,sqlite3,re,sys
from pathlib import Path
D=Path(__file__).resolve().parent
con=sqlite3.connect(sys.argv[1]);con.executescript('''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,path TEXT NOT NULL UNIQUE,title TEXT NOT NULL,type TEXT NOT NULL,year INTEGER,source TEXT NOT NULL DEFAULT 'movielinkbd',sample_only INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS posts_type_year ON posts(type,year);
CREATE TABLE IF NOT EXISTS refs(id INTEGER PRIMARY KEY,post_id INTEGER NOT NULL REFERENCES posts(id),path TEXT NOT NULL,quality INTEGER,name TEXT,label TEXT,size TEXT,seen_at INTEGER NOT NULL,UNIQUE(post_id,path));
CREATE TABLE IF NOT EXISTS episode_refs(ref_id INTEGER NOT NULL REFERENCES refs(id),season INTEGER,episode INTEGER NOT NULL,UNIQUE(ref_id,season,episode));
CREATE INDEX IF NOT EXISTS ref_post ON refs(post_id,quality);
CREATE INDEX IF NOT EXISTS ep_lookup ON episode_refs(episode,season,ref_id);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
''')
if con.execute('select count(*) from posts').fetchone()[0]==0:
 entries=json.loads((D/'catalog-sample.json').read_text())['entries']
 with con:
  for x in entries:
   y=re.search(r'\b(19\d\d|20\d\d)\b',x['title']);con.execute('INSERT OR IGNORE INTO posts(path,title,type,year) VALUES(?,?,?,?)',(x['path'],x['title'],x['type'],int(y[1]) if y else None))
print('posts',con.execute('select count(*) from posts').fetchone()[0]);con.close()
