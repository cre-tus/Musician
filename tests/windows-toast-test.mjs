import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Windows toast app-icon contract: the NotifyIcon balloon shows the Musician
// icon instead of the generic information glyph. The toast command builder
// takes an icon path (missing file falls back to the system icon), main
// resolves the packaged-or-dev icon and passes it, and the icon ships in
// extraResources so the portable build carries it.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const toast = require(path.join(root, 'scripts', 'windows-toast.js'));
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const decode = (b64) => Buffer.from(b64, 'base64').toString('utf16le');

// 1. Without an icon the generic glyph stays (backward compatible).
const plain = decode(toast.encodedToastCommand('t', 'm'));
assert.ok(plain.includes('[System.Drawing.SystemIcons]::Information'), 'fallback glyph present');
assert.ok(!plain.includes('System.Drawing.Icon('), 'no custom icon without a path');
console.log('ok - default glyph unchanged');

// 2. With an icon path the balloon loads it, with a missing-file fallback.
const custom = decode(toast.encodedToastCommand('t', 'm', 'C:\\app\\icon.ico'));
assert.ok(custom.includes('System.Drawing.Icon('), 'custom icon constructed');
assert.ok(custom.includes('C:\\app\\icon.ico'), 'icon path embedded');
assert.ok(custom.includes('Test-Path'), 'missing-file fallback guard');
const realIcon = path.join(root, 'build', 'icon.ico');
const real = decode(toast.encodedToastCommand('t', 'm', realIcon));
assert.ok(real.includes('System.Drawing.Icon(') && fs.existsSync(realIcon), 'real icon path resolves');
console.log('ok - custom icon embedded with fallback');

// 3. Main resolves the packaged-or-dev icon and passes it through.
assert.ok(/showWindowsToastAsync\(.{0,300}toastIcon/s.test(main), 'main passes an icon path');
assert.ok(main.includes('resourcesPath') && main.includes('icon.ico'), 'packaged icon resolved');
console.log('ok - main icon wiring');

// 4. The icon ships with the portable build.
const resources = JSON.stringify((pkg.build || {}).extraResources || []);
assert.ok(resources.includes('icon.ico'), 'extraResources carries icon.ico');
assert.ok(fs.existsSync(path.join(root, 'build', 'icon.ico')), 'icon.ico exists');
console.log('ok - icon packaged');

console.log('WINDOWS TOAST TEST: ALL PASS');
