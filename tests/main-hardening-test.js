'use strict';

// Main-window hardening contract: the privileged window (full IPC bridge)
// must never host foreign content, and packaged builds run single-instance.
// Wiring is pinned by source asserts; behavior needs a live Electron window.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('electron/main.js');
const pkg = JSON.parse(read('package.json'));

// 1. No foreign content in the privileged window.
assert.ok(main.includes("setWindowOpenHandler(() => ({ action: 'deny' }))"), 'main denies new windows');
assert.ok(main.includes("on('will-attach-webview'"), 'main denies webview attach');
assert.ok(main.includes("on('will-navigate'"), 'main guards top-level navigation');
assert.ok(main.includes('isBundledFileUrl(url)'), 'navigation allowlist covers the bundled renderer');
assert.ok(main.includes("fileURLToPath"), 'file URLs resolve to real paths before comparison');
console.log('ok - navigation guards');

// 2. Single instance for packaged builds (dev keeps multi-instance).
assert.ok(main.includes('app.requestSingleInstanceLock()'), 'packaged builds take the instance lock');
assert.ok(main.includes("app.on('second-instance'"), 'second launch focuses the running app');
assert.ok(main.includes('if (!singleInstanceOk) return;'), 'losing instance never boots');
console.log('ok - single instance');

// 3. Suite wiring.
assert.ok((pkg.scripts.test || '').includes('main-hardening:test'), 'test chain includes main-hardening');
assert.equal(pkg.scripts['main-hardening:test'], 'node tests/main-hardening-test.js');
console.log('ok - suite wiring');

console.log('MAIN HARDENING TEST: ALL PASS');
