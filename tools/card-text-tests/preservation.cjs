'use strict';
// Undo only the pinned card-display changes, then let every older preservation
// layer verify its original hashes. No new hash replaces an older baseline.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const edits = require('./fixtures/authorized-edits.json');
const { beforeSourceReview } = require('../source-review-tests/preservation.cjs');
function beforeCardText(file) {
  let value = beforeSourceReview(file);
  const undo = edits.filter(e => e.file === file).reverse();
  if (undo.length) {
    let text = value.toString('utf8');
    for (const e of undo) {
      assert.equal(text.split(e.new).length - 1, e.count, 'Exact card-text inverse: ' + file + ' (' + e.reason + ')');
      text = text.split(e.new).join(e.old);
    }
    value = Buffer.from(text);
  }
  return value;
}
module.exports = { beforeCardText };
