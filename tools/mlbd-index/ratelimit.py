"""Persist host cooldown across workers and workflow runs."""
import time,email.utils

def until(value,now=None):
 now=int(time.time()) if now is None else int(now)
 try:
  seconds=int(value)
  return max(now+900,now+max(0,seconds))
 except (ValueError,TypeError):
  try:
   date=email.utils.parsedate_to_datetime(value)
   return max(now+900,int(date.timestamp()))
  except (ValueError,TypeError,OverflowError):return now+900

def is_paused(db):
 row=db.execute("SELECT value FROM state WHERE key='cooldown_until'").fetchone()
 return bool(row and int(row[0])>int(time.time()))

def pause(db,header):
 end=until(header)
 with db:
  db.execute("INSERT INTO state(key,value) VALUES('cooldown_until',?) ON CONFLICT(key) DO UPDATE SET value=CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)",(str(end),))
 return end
