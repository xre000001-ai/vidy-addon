'use strict';
// Use the addon's existing installed dependency; never load a workspace fallback.
module.exports = name => { if (name !== 'undici') throw Error('Unexpected CineJoy dependency'); return require('undici'); };
