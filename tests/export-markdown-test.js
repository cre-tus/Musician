'use strict';
// Export-markdown verification: title -> safe filename sanitization used by
// the main-side save handler (the native save dialog itself is undrivable
// in E2E, so this pure helper + wiring assertion is the committed coverage).
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exportMarkdownFilename } = require('../electron/export-markdown');

assert.equal(exportMarkdownFilename('hello'), 'hello');
assert.equal(exportMarkdownFilename('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j');
assert.equal(exportMarkdownFilename('abc...   '), 'abc', 'trailing dots/spaces stripped');
assert.equal(exportMarkdownFilename('a\nb\rc\td'), 'a b c d');
assert.equal(exportMarkdownFilename(''), 'Musician 대화');
assert.equal(exportMarkdownFilename(undefined), 'Musician 대화');
assert.equal(exportMarkdownFilename('x'.repeat(200)).length, 120);
assert.equal(exportMarkdownFilename('<<<'), '---');
assert.equal(exportMarkdownFilename('...'), 'Musician 대화', 'all stripped falls back');
assert.equal(exportMarkdownFilename('  spaced  '), 'spaced');
console.log('ok - filename table');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
assert.ok(main.includes("require('./export-markdown')"), 'main uses the export-markdown module');
assert.ok(/mudex:export-markdown[\s\S]{0,600}exportMarkdownFilename\(/.test(main), 'export handler wired');
console.log('ok - main wiring');

console.log('EXPORT MARKDOWN TEST: ALL PASS');
