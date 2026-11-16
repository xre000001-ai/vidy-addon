#!/usr/bin/env node
'use strict';
// v1.34.260 — Multimovies 4K download-page parser (offline; fixture = m1.multimovies.courses,
// captured 16-11-2026 for "Spider-Man: Brand New Day" — 4K UHD 2160p 81.9 GB + 1080p FHD 17.98 GB).
const assert = require('assert');
const lib = require('../vidy-runtime/mmhub.cjs');

const FIXTURE = `<div class="dl-package-card"><div class="dl-package-header"><div class="dl-package-quality"><svg width="20" height="20"><rect/></svg><span>4K UHD 2160p</span></div><span class="dl-size-badge">81.9 GB</span></div><div class="dl-mirrors-grid"><a href="https://hubcloud.ist/drive/ngbb9vo7ogth8nm" class="dl-mirror-btn">HubCloud</a><a href="https://hubcloud.ist/drive/40z1jzdqlx1dh8l" class="dl-mirror-btn">HubCloud</a><a href="https://hubcloud.ist/drive/h8qnjsjbhzwn7q7" class="dl-mirror-btn">HubCloud</a></div></div>
<div class="dl-package-card"><div class="dl-package-header"><div class="dl-package-quality"><svg width="20" height="20"><rect/></svg><span>1080p FHD</span></div><span class="dl-size-badge">17.98 GB</span></div><div class="dl-mirrors-grid"><a href="https://hubcloud.ist/drive/y4zzorzwf8o1zbg" class="dl-mirror-btn">HubCloud</a><a href="https://hubcloud.ist/drive/92vh4fknviazhf1" class="dl-mirror-btn">HubCloud</a><a href="https://hubcloud.ist/drive/nwwhcnmhgxpxchx" class="dl-mirror-btn">HubCloud</a></div></div>`;

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; };

// 1) quality ladder
ok('q2160', lib.qualityOf('4K UHD 2160p') === 2160);
ok('q2160b', lib.qualityOf('2160p') === 2160);
ok('q4k', lib.qualityOf('4K') === 2160);
ok('q1080', lib.qualityOf('1080p FHD') === 1080);
ok('q480', lib.qualityOf('480p') === 480);
ok('q0', lib.qualityOf('HD WEB-DL [Hindi + English]') === 0);

// 2) identity gate — the wrong film must never inherit the file
ok('same', lib.titleMatch('Spider-Man: Brand New Day', 'Spider-Man: Brand New Day', 2026, 2026));
ok('fold', lib.titleMatch('Spider-Man: Brand New Day', 'spiderman brand new day', 0, 0));
ok('paren', lib.titleMatch('Spider-Man: Brand New Day', 'Spider-Man: Brand New Day (2026)', 2026, 2026));
// a re-release whose year is 15 years off is a different entry — the year gate wins
ok('paren-year-gate', lib.titleMatch('Breaking Bad', 'Breaking Bad (Now in Hindi)', 2008, 2023) === false);
ok('year-off', lib.titleMatch('Spider-Man: Brand New Day', 'Spider-Man: Brand New Day', 2026, 2002) === false);
ok('other-film', lib.titleMatch('Spider-Man: Brand New Day', 'Spider-Man: Across the Spider-Verse', 0, 0) === false);
ok('empty', lib.titleMatch('', 'Anything', 0, 0) === false);

// 3) package parse: 4K first, drives de-duplicated, absolute HubCloud ids only
const pkgs = lib.parsePackages(FIXTURE);
ok('two-pkgs', pkgs.length === 2);
ok('best-4k', pkgs[0].q === 2160 && pkgs[0].size === '81.9 GB');
ok('second-1080', pkgs[1].q === 1080 && /17\.98/.test(pkgs[1].size));
ok('drives', pkgs[0].drives.length === 3 && pkgs[0].drives.every(u => /^https:\/\/hubcloud\.ist\/drive\/[A-Za-z0-9]+$/.test(u)));
ok('drive-id-real', pkgs[0].drives[0] === 'https://hubcloud.ist/drive/ngbb9vo7ogth8nm');
ok('sorted', pkgs[0].q >= pkgs[1].q);

// 4) no fabricated packages from a page without mirrors (measured: The Dark Knight ->
//    /download/the-dark-knight-780 has the CSS class but zero cards)
ok('empty-page', lib.parsePackages('<html><style>.dl-package-card{}</style></html>').length === 0);
ok('no-mirror', lib.parsePackages('<div class="dl-package-card"><div class="dl-package-quality"><span>4K UHD 2160p</span></div></div>').length === 0);
ok('no-quality', lib.parsePackages('<div class="dl-package-card"><a href="https://hubcloud.ist/drive/abc12345">x</a></div>').length === 0);
// relative/short ids are not usable file ids
ok('short-id', lib.parsePackages('<div class="dl-package-card"><div class="dl-package-quality"><span>1080p</span></div><a href="https://hubcloud.ist/drive/ab">x</a></div>').length === 0);

console.log('mmhub: ' + pass + ' assertions passed');
