#!/usr/bin/env node
'use strict';
// v1.34.262 — MultiMovies Orion/Vidrift embed parsing (offline).
// Fixture = embed.vidrift.net/embed/movie/969681 captured 16-11-2026
// (Orion streams, one per language, rungs 480/720/1080, segment host sacdn.hakunaymatata.com).
const assert = require('assert');
const lib = require('../vidy-runtime/mmvidrift.cjs');

const FIXTURE = `<html><script>window.__PLAYER__ = {"playbackToken":"x","orionStreams":[{"index": 0, "url": "/api/orion/81ec24ef8b3050f052888f10411e83a5/master.m3u8", "type": "hls", "provider": "Orion", "name": "Orion Â· Original", "rungs": [{"width": 2592, "height": 1080}, {"width": 1728, "height": 720}, {"width": 1152, "height": 480}]}, {"index": 1, "url": "/api/orion/273686ad7a0a722a2c5dbba8de90cbd2/master.m3u8", "type": "hls", "provider": "Orion", "name": "Orion Â· Hindi", "rungs": [{"width": 2592, "height": 1080}, {"width": 1728, "height": 720}, {"width": 1152, "height": 480}]}, {"index": 2, "url": "/api/orion/0dbdf7dc8505604b032ee26c9abec46c/master.m3u8", "type": "hls", "provider": "Orion", "name": "Orion Â· Tamil", "rungs": [{"width": 2592, "height": 1080}, {"width": 1728, "height": 720}, {"width": 1152, "height": 480}]}, {"index": 3, "url": "/api/orion/28b8db60f1285f4e4e205d76eb986174/master.m3u8", "type": "hls", "provider": "Orion", "name": "Orion Â· Telugu", "rungs": [{"width": 2592, "height": 1080}, {"width": 1728, "height": 720}, {"width": 1152, "height": 480}]}],"after":[]};</script></html>`;

let pass = 0;
const ok = (n, c) => { assert.ok(c, n); pass++; };

// 1) the array survives a page that contains other arrays around it
const arr = lib.orionStreams(FIXTURE);
ok('parsed-4', arr.length === 4);
ok('url-shape', arr.every(s => /^\/api\/orion\//.test(s.url)));
ok('rungs', arr.every(s => Array.isArray(s.rungs) && s.rungs.length === 3));

// 2) cards: one per language at the TOP rung only, 480 never emitted
const cards = lib.cardsFromStreams(arr, 'https://embed.vidrift.net', 720);
ok('cards-4', cards.length === 4);
ok('top-1080', cards.every(c => c.h === 1080));
ok('abs-url', cards.every(c => /^https:\/\/embed\.vidrift\.net\/api\/orion\/[a-f0-9]+\/master\.m3u8$/.test(c.url)));
ok('lang-original', cards[0].lang === 'English');           // "Orion · Original" -> English
ok('lang-hindi', cards[1].lang === 'Hindi');
ok('lang-tamil', cards[2].lang === 'Tamil');
ok('lang-telugu', cards[3].lang === 'Telugu');
ok('hs-kept', JSON.stringify(cards[0].hs) === JSON.stringify([1080, 720]));

// 3) 480-only stream must produce no card at all
const low = [{ index: 9, url: '/api/orion/deadbeef/master.m3u8', name: 'Orion · Hindi', rungs: [{ width: 1152, height: 480 }] }];
ok('no-480', lib.cardsFromStreams(low, 'https://embed.vidrift.net', 720).length === 0);

// 4) foreign/absolute urls are not turned into cards (only the embed's own proxy paths)
const abs = [{ index: 1, url: 'https://evil.example/x.m3u8', name: 'Orion · Hindi', rungs: [{ width: 1920, height: 1080 }] }];
ok('no-foreign-url', lib.cardsFromStreams(abs, 'https://embed.vidrift.net', 720).length === 0);

// 5) garbage in, empty out (never throws)
ok('empty', lib.orionStreams('').length === 0);
ok('no-json', lib.orionStreams('<html>no streams here</html>').length === 0);
ok('broken', lib.orionStreams('"orionStreams":[{"url":').length === 0);

console.log('mmvidrift: ' + pass + ' assertions passed');
