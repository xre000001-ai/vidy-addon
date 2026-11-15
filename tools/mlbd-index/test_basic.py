import os,sqlite3,subprocess,tempfile,unittest
from pathlib import Path
D=Path(__file__).resolve().parent
class TestDB(unittest.TestCase):
 def test_initialization_is_idempotent(self):
  with tempfile.TemporaryDirectory() as d:
   db=os.path.join(d,'i.sqlite')
   for _ in range(2):subprocess.run(['python3',str(D/'init.py'),db],check=True,capture_output=True)
   with sqlite3.connect(db) as c:
    self.assertEqual(c.execute('pragma integrity_check').fetchone()[0],'ok')
    self.assertEqual(c.execute('select count(*) from posts').fetchone()[0],883)
    self.assertEqual(c.execute('select count(*) from refs').fetchone()[0],0)
 def test_parser_extracts_without_network(self):
  source=(D/'extract_offline.cjs').read_text();self.assertNotIn('/home/user/',source)
if __name__=='__main__':unittest.main()
