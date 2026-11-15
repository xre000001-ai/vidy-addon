import concurrent.futures, sqlite3, tempfile, unittest, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from claim import claim
from ratelimit import until
class ClaimTest(unittest.TestCase):
 def test_retry_after_floor(self):
  self.assertEqual(until('5',1000),1900)
  self.assertEqual(until('3600',1000),4600)
  self.assertEqual(until(None,1000),1900)
 def test_parallel_exactly_once(self):
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'x.sqlite');db=sqlite3.connect(path)
   db.executescript("create table jobs(path text,post_id int,depth int,state text,attempts int);create table file_jobs(path text,ref_id int,depth int,state text,attempts int);")
   db.executemany("insert into jobs values(?,?,0,'pending',0)", [(str(i),i) for i in range(100)]);db.commit();db.close()
   def worker(_):
    c=sqlite3.connect(path,timeout=20);out=[]
    while True:
     k,j=claim(c,False)
     if j is None:break
     out.append(j[1])
    c.close();return out
   with concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: ids=sum(e.map(worker,range(8)),[])
   self.assertEqual(len(ids),100);self.assertEqual(len(set(ids)),100)
if __name__=='__main__':unittest.main()
