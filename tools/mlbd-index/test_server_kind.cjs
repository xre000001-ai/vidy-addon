'use strict';const assert=require('assert'),x=require('./server_kind.cjs');
assert.equal(x.classify('Download MP4 — Fast Cloud','https://a.r2.cloudflarestorage.com/x'),'MP4 Fast Cloud');
assert.equal(x.classify('Download MP4 — Fast Cloud','https://fsldownload.com/d/x'),'FSL');
assert.equal(x.classify('Other','https://a.r2.cloudflarestorage.com/x'),'FSL');
assert.equal(x.filename('Film.720p.mkv','MP4 Fast Cloud'),'Film.720p.mp4');
assert.equal(x.filename('Film.mkv','FSL'),'Film.mkv');console.log('MovieLinkBD server identity and filename passed');
