'use strict';const assert=require('assert');const {seasonFile}=require('./season_file');
assert.equal(seasonFile('GDFlix | CineDoze.TV-Take Charge of My Heart (2026) MLSBD.Co-S01 Dual Audio Netflix 720p.mkv',1).quality,720);
for(const s of ['Show S02 720p.mkv','Show S01E01 720p.mkv','Show S01E01-10 1080p.mkv','Show S01 480p.mkv','Show S01 720p.zip'])assert.equal(seasonFile(s,1),null,s);
console.log('season-file metadata safety passed');
