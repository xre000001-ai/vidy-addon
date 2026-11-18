'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
function sh(cmd) { try { const cp = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 60000 }); return ((cp.stdout || '') + (cp.stderr || '')).trim(); } catch (e) { return 'ERR ' + e.message; } }
const out = [];
out.push('uid=' + sh('id -u') + ' user=' + sh('whoami'));
out.push('apt=' + sh('which apt-get || echo none') + ' sudo=' + sh('which sudo || echo none'));
let exe = null;
try { exe = require('./nexa-browser').exePath(); } catch (e) { }
out.push('exe=' + exe);
if (exe) {
  out.push('missing-libs=\n' + sh('ldd "' + exe + '" | grep "not found" || echo NONE'));
  out.push('version=' + sh('"' + exe + '" --version 2>&1 | head -3'));
}
console.log('\n[nexa-diag]\n' + out.join('\n') + '\n[/nexa-diag]');
