'use strict';

// Guards against runtime "Cannot find module" in the packaged app: every
// relative require() in packaged JS must resolve and be covered by
// package.json build.files (plus extraResources presence).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkPackagingManifest } = require('../scripts/packaging-manifest');

const violations = checkPackagingManifest(path.resolve(__dirname, '..'));
if (violations.length > 0) {
  console.error(`packaging-manifest: ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('packaging-manifest: all packaged requires resolve and are covered by build.files.');

// Dynamic import() is a runtime load too: uncovered packages must fail.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-packaging-manifest-'));
const fixture = path.join(tmp, 'app');
fs.mkdirSync(path.join(fixture, 'electron'), { recursive: true });
fs.writeFileSync(
  path.join(fixture, 'package.json'),
  JSON.stringify({ build: { files: ['electron/**/*'] } }),
);
fs.writeFileSync(path.join(fixture, 'electron', 'a.js'), "const p = import('missing-pkg');\nmodule.exports = { p };\n");
const missing = checkPackagingManifest(fixture);
assert.ok(missing.some((v) => v.includes("import('missing-pkg')") || v.includes('missing-pkg')), `dynamic import violation expected, got: ${JSON.stringify(missing)}`);
fs.writeFileSync(path.join(fixture, 'electron', 'a.js'), "const p = import('./b.js');\nmodule.exports = { p };\n");
fs.writeFileSync(path.join(fixture, 'electron', 'b.js'), 'module.exports = {};\n');
assert.deepEqual(checkPackagingManifest(fixture), []);
console.log('packaging-manifest: dynamic import() loads are covered too.');
