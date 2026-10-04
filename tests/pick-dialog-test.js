'use strict';
// Pick-dialog verification: normalize native dialog results into the IPC
// contract (the OS dialog itself is undrivable in E2E, so this pure
// normalizer + wiring assertion is the committed coverage).
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pickDialogResult } = require('../electron/pick-dialog');

// 1. files: cancel -> cancelled, paths pass through verbatim.
assert.deepEqual(pickDialogResult('files', { canceled: true, filePaths: ['a'] }), { ok: false, cancelled: true });
assert.deepEqual(pickDialogResult('files', { canceled: false, filePaths: ['a', 'b'] }), { ok: true, paths: ['a', 'b'] });
// 2. files: empty-but-not-canceled passes through as ok (renderer guards
// length; preserved legacy semantics, not normalized to cancelled).
assert.deepEqual(pickDialogResult('files', { canceled: false, filePaths: [] }), { ok: true, paths: [] });
// 3. folder: cancel OR empty -> cancelled; else first path.
assert.deepEqual(pickDialogResult('folder', { canceled: true, filePaths: ['a'] }), { ok: false, cancelled: true });
assert.deepEqual(pickDialogResult('folder', { canceled: false, filePaths: [] }), { ok: false, cancelled: true });
assert.deepEqual(pickDialogResult('folder', { canceled: false, filePaths: ['a', 'b'] }), { ok: true, path: 'a' });
// 4. malformed results never throw, treated as cancelled.
assert.deepEqual(pickDialogResult('files', null), { ok: false, cancelled: true });
assert.deepEqual(pickDialogResult('folder', {}), { ok: false, cancelled: true });
assert.deepEqual(pickDialogResult('nope', { canceled: false, filePaths: ['a'] }), { ok: false, cancelled: true });
console.log('ok - result table');

// 5. wiring: both handlers use the normalizer.
const main = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
assert.ok(main.includes("require('./pick-dialog')"), 'main uses the pick-dialog module');
assert.ok(/mudex:pick-files[\s\S]{0,400}pickDialogResult\('files'/.test(main), 'pick-files wired');
assert.ok(/mudex:pick-folder[\s\S]{0,400}pickDialogResult\('folder'/.test(main), 'pick-folder wired');
console.log('ok - main wiring');

console.log('PICK DIALOG TEST: ALL PASS');
