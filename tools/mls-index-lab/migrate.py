#!/usr/bin/env python3
"""Invalidate page checkpoints once when the link-page parser schema changes.
Never deletes posts or mirror entries; re-scan gradually augments existing rows.
"""
import sqlite3,sys
p=sys.argv[1];d=sqlite3.connect(p)
d.executescript('CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE IF NOT EXISTS pages(page INTEGER PRIMARY KEY,checked INTEGER,rows INTEGER); CREATE TABLE IF NOT EXISTS attempts(page INTEGER PRIMARY KEY,checked INTEGER);')
r=d.execute("select v from state where k='link_parser_schema'").fetchone()
if not r or r[0]!='2':
 with d:
  d.execute('DELETE FROM pages');d.execute('DELETE FROM attempts');d.execute("INSERT OR REPLACE INTO state VALUES('link_parser_schema','2')")
 print('link-page parser changed; page rescan queued, existing posts retained')
else:print('link parser schema current')
d.close()
