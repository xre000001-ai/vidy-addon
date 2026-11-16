'use strict';
// Keep a small window for decryption/decorating before the foreground cut.
function waitMs(collect,deadline,now=Date.now()) {
 const n=Math.max(0,Number(collect)||0);
 if (!Number.isFinite(deadline)) return n;
 return Math.max(0,Math.min(n,deadline-now));
}
module.exports={waitMs};
