import unittest,sqlite3,json
from unittest.mock import patch,Mock
import indexer as m
class Test(unittest.TestCase):
 def test_quality_episode(self):
  x=m.extract_post('<p>Episode 12</p><a class="Dbtn" href="https://savelinks.me/view/AbC123">Download 1080p</a>');self.assertEqual((x[0]['episode'],x[0]['quality']),(12,1080))
 def test_joya9_and_savelinks_distinct_hosts(self):
  x=m.extract_post('<a href="https://savelinks.me/view/Same12">720p</a><a href="https://joya9links.com/view/Same12">1080p</a>');self.assertEqual(len(x),2);self.assertEqual(x[1]['url'],'https://joya9links.com/view/Same12')
 def test_episode_range_is_not_single_episode(self):
  x=m.extract_post('<p>Download Now Epi-129-134 WEB-DL</p><a href="https://savelinks.me/view/AbC123">Download 1080p</a>');self.assertEqual((x[0]['episode'],x[0]['episode_end']),(129,134))
 def test_no_false_episode_from_file_size(self):
  x=m.extract_post('<p>Size 700MB</p><a href="https://savelinks.me/view/AbC123">Download 720p</a>');self.assertEqual(x[0]['episode'],0)
 def test_legacy_page_refs(self):
  x=m.other_pages('<a href="http://link.bonghd.com/?x_data=ABC%3D:1">Download</a><a href="https://pixeldrain.com/u/b">PD</a><a href="https://evil.example/?a=x">x</a>');self.assertEqual(len(x),2)
 def test_mirrors(self):
  x=m.mirror_links('<a href="https://gdflix.vip/file/a">GD</a><a href="https://pixeldrain.com/u/xyz">PD</a><a href="https://evil.example/">x</a>');self.assertEqual(len(x),2)
 def test_gdx_mirror_is_preserved(self):
  x=m.mirror_links('<a href="https://gdxfiles.com/file/35yt35mrv8ry">GDx</a><a href="https://evil.example/file/aaa">bad</a>');self.assertEqual([v['url'] for v in x],['https://gdxfiles.com/file/35yt35mrv8ry'])
 def test_reader_error(self):
  with patch('indexer.requests.get',return_value=Mock(status_code=200,text='{"code":401}',raise_for_status=lambda:None)):
   with self.assertRaises(ValueError):m.wp(1)
 def test_untitled_wp_post(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT)')
  m.savepost(db,{'id':42,'title':{'rendered':''},'link':'https://mlsbd.co/untitled','content':{'rendered':''}})
  self.assertEqual(db.execute('select title from posts').fetchone()[0],'[Untitled WP post 42]')
 def test_empty_response_retains_last_good_refs(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT)')
  a={'id':5,'title':{'rendered':'Show'},'link':'https://mlsbd.co/a','content':{'rendered':'<a href="https://savelinks.me/view/ABC">720p</a><a href="https://gdxfiles.com/file/abc">GDx</a>'}}
  m.savepost(db,a);m.savepost(db,dict(a,content={'rendered':''}))
  self.assertEqual(json.loads(db.execute('SELECT links FROM posts').fetchone()[0])[0]['id'],'ABC')
  self.assertEqual(len(json.loads(db.execute('SELECT links FROM post_other').fetchone()[0])),1)
 def test_upsert_invalid_transaction(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,url TEXT,date TEXT,modified TEXT,links TEXT)')
  a={'id':1,'title':{'rendered':'Good'},'link':'https://mlsbd.co/a','content':{'rendered':'<a href="https://savelinks.me/view/AAA">720p</a>'}}
  with db:m.savepost(db,a)
  with self.assertRaises(ValueError):
   with db:m.savepost(db,dict(a,link=''))
  self.assertEqual(json.loads(db.execute('SELECT links FROM posts').fetchone()[0])[0]['id'],'AAA')
if __name__=='__main__':unittest.main()
