'use strict';
// Prewarm wiring regression test: launching the exe must eagerly start
// `muse serve` instead of waiting for the first chat.
// Exit 0 = ALL PASS, exit 1 = FAIL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const types = read('src/types.ts');
const appView = read('src/App.tsx');

// 1. main warms MSP at startup (inside app.whenReady, before first chat).
assert.ok(/app\.whenReady\(\)\.then\([\s\S]*?prewarmMsp/.test(main), 'main prewarms MSP on app ready');
assert.ok(/ensureHost/.test(main), 'main prewarm goes through MspEngine.ensureHost');
// 2. renderer can request a prewarm for its own folder via IPC.
assert.ok(/['"]msp:prewarm['"]/.test(main), 'main handles msp:prewarm');
assert.ok(/mspPrewarm/.test(preload), 'preload exposes mspPrewarm');
assert.ok(/mspPrewarm/.test(types), 'MudexApi declares mspPrewarm');
assert.ok(/mspPrewarm/.test(appView), 'renderer requests prewarm on boot');
// 3. prewarm reports readiness without blocking launch.
assert.ok(/msp:ready/.test(main), 'main emits msp:ready');
assert.ok(/onMspReady/.test(preload), 'preload exposes onMspReady');
// 4. prewarm never blocks launch: failures are caught and reported.
assert.ok(/msp:prewarm-error/.test(main), 'main reports msp:prewarm-error');

console.log('ok - startup prewarm wiring');
console.log('ok - renderer prewarm request');
console.log('ok - readiness + failure reporting');
console.log('MSP PREWARM TEST: ALL PASS');
