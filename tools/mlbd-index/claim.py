"""Atomic per-job claims for cooperating workers sharing a SQLite database."""
def claim(db,prefer_file):
 db.execute('BEGIN IMMEDIATE')
 try:
  job=None;kind=None
  for k in (('file','title') if prefer_file else ('title','file')):
   if k=='file':
    row=db.execute("SELECT path,ref_id,depth FROM file_jobs WHERE state='pending' AND attempts<3 ORDER BY attempts,depth,rowid LIMIT 1").fetchone()
    if row: db.execute("UPDATE file_jobs SET state='running' WHERE path=? AND ref_id=?",(row[0],row[1]))
   else:
    row=db.execute("SELECT path,post_id,depth FROM jobs WHERE state='pending' AND attempts<3 ORDER BY attempts,rowid LIMIT 1").fetchone()
    if row: db.execute("UPDATE jobs SET state='running' WHERE path=? AND post_id=?",(row[0],row[1]))
   if row:job=row;kind=k;break
  db.commit();return kind,job
 except BaseException:
  db.rollback();raise
