import json,sqlite3,tempfile,unittest,sys
from unittest.mock import patch
from types import SimpleNamespace
import refresh
class RefreshTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=self.tmp.name+'/x.sqlite';self.pool=self.tmp.name+'/pool.json';open(self.pool,'w').write(json.dumps({'good':[{'proxy':'http://127.0.0.1:1'}]}))
 def tearDown(self):self.tmp.cleanup()
 def run_refresh(self,output):
  with patch.object(sys,'argv',['refresh.py','--db',self.db,'--proxy-list',self.pool,'--max-pages','1']),patch('refresh.subprocess.run',return_value=SimpleNamespace(stdout=output)):
   refresh.main()
 def test_failure_preserves_watermark(self):
  d=sqlite3.connect(self.db);d.executescript("CREATE TABLE state(k TEXT PRIMARY KEY,v TEXT); INSERT INTO state VALUES('refresh_watermark','2026-01-01T00:00:00');");d.close()
  self.run_refresh('{"message":"blocked"}\n403');d=sqlite3.connect(self.db);self.assertEqual(d.execute("select v from state where k='refresh_watermark'").fetchone()[0],'2026-01-01T00:00:00');self.assertEqual(d.execute("select v from state where k='refresh_page'").fetchone()[0],'1')
 def test_success_updates_changed_post(self):
  row={'id':10,'title':{'rendered':'Updated movie'},'link':'https://mlsbd.co/item','content':{'rendered':'<a href="https://savelinks.me/view/XYZ">720p</a>'},'modified':'2026-01-01T00:00:00'}
  self.run_refresh(json.dumps([row])+'\n200');d=sqlite3.connect(self.db);self.assertEqual(d.execute('select title from posts where id=10').fetchone()[0],'Updated movie');self.assertIsNotNone(d.execute("select v from state where k='refresh_watermark'").fetchone());self.assertIsNone(d.execute("select v from state where k='refresh_page'").fetchone())
if __name__=='__main__':unittest.main()
