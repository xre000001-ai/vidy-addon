#!/usr/bin/env node
// DeadToons v4 entrypoint. Generated data never writes main; see dedicated CLI
// stages and .github/workflows/dt-index.yml for automatic background indexing.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./tools/deadtoons-index/cli.cjs').main().catch(e => {
  console.error('[deadtoons-index] ' + String(e.message || e));
  process.exitCode = 1;
});
