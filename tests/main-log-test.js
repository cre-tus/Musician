'use strict';
// Main-process file logging. Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendMainLog } = require('../electron/main-log');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-main-log-'));

(async () => {
  // 1. JSON line appended with tag and payload.
  assert.equal(appendMainLog(tmp, 'mcp-preflight', { name: 'musician-browser', reason: 'BRIDGE_UNREACHABLE:x' }), true);
  const lines = fs.readFileSync(path.join(tmp, 'musician.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z mcp-preflight /);
  assert.deepEqual(JSON.parse(lines[0].slice(lines[0].indexOf('{'))), { name: 'musician-browser', reason: 'BRIDGE_UNREACHABLE:x' });

  // 2. appends keep earlier lines; unserializable payloads still log the tag.
  assert.equal(appendMainLog(tmp, 'mcp-register', { status: 'added' }), true);
  const again = fs.readFileSync(path.join(tmp, 'musician.log'), 'utf8').trim().split('\n');
  assert.equal(again.length, 2);
  const circular = {};
  circular.self = circular;
  assert.equal(appendMainLog(tmp, 'broken', circular), false);
  assert.equal(fs.readFileSync(path.join(tmp, 'musician.log'), 'utf8').trim().split('\n').length, 2);

  // 3. bad directory fails false, never throws.
  assert.equal(appendMainLog(path.join(tmp, 'nope', 'deeper'), 'x', {}), false);

  console.log('ok - main-log (3 cases)');
})();
