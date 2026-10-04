'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUrl, resolveBrowserStartUrl, resolveAddressInput, isNavigableBrowserUrl } = require('../electron/browser');

assert.equal(normalizeUrl('example.com'), 'https://example.com');
assert.equal(normalizeUrl('https://example.com/path'), 'https://example.com/path');
assert.equal(normalizeUrl('example.com:8443/path'), 'https://example.com:8443/path');
assert.equal(normalizeUrl('localhost'), 'http://localhost');
assert.equal(normalizeUrl('localhost:5173/path'), 'http://localhost:5173/path');
assert.equal(normalizeUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000');
assert.equal(normalizeUrl('[::1]:8080'), 'http://[::1]:8080');
assert.equal(normalizeUrl('about:blank'), 'about:blank');
assert.throws(() => normalizeUrl('  '), /EMPTY_URL/);
assert.equal(resolveBrowserStartUrl('https://last.example/path', 'https://home.example'), 'https://last.example/path');
assert.equal(resolveBrowserStartUrl('', 'https://home.example'), 'https://home.example');
assert.equal(resolveBrowserStartUrl('javascript:alert(1)', 'https://home.example'), 'https://home.example');
assert.equal(resolveBrowserStartUrl('https://[invalid', ''), 'https://www.google.com');

// Address-bar input: URLs navigate, anything else searches (Google,
// matching the default start page). Single dot-less tokens count as
// search terms — predictable and pinned here.
assert.equal(typeof resolveAddressInput, 'function');
assert.equal(resolveAddressInput('example.com'), 'https://example.com');
assert.equal(resolveAddressInput('https://example.com/path'), 'https://example.com/path');
assert.equal(resolveAddressInput('localhost:5173/path'), 'http://localhost:5173/path');
assert.equal(resolveAddressInput('about:blank'), 'about:blank');
assert.equal(resolveAddressInput('  example.com  '), 'https://example.com');
assert.equal(resolveAddressInput('오늘 날씨'), 'https://www.google.com/search?q=%EC%98%A4%EB%8A%98%20%EB%82%A0%EC%94%A8');
assert.equal(resolveAddressInput('electron webcontentsview'), 'https://www.google.com/search?q=electron%20webcontentsview');
assert.equal(resolveAddressInput('intranet'), 'https://www.google.com/search?q=intranet');
assert.equal(resolveAddressInput('example.com/a b'), 'https://www.google.com/search?q=example.com%2Fa%20b');
assert.throws(() => resolveAddressInput('  '), /EMPTY_URL/);

// Tab navigation allowlist: http(s), local files, and blank pages only.
// Agent bridge and popups go through the same gate before loadURL.
assert.equal(typeof isNavigableBrowserUrl, 'function');
assert.equal(isNavigableBrowserUrl('https://example.com/path'), true);
assert.equal(isNavigableBrowserUrl('http://localhost:5173/'), true);
assert.equal(isNavigableBrowserUrl('file:///C:/docs/note.html'), true);
assert.equal(isNavigableBrowserUrl('about:blank'), true);
assert.equal(isNavigableBrowserUrl('javascript:alert(1)'), false);
assert.equal(isNavigableBrowserUrl('data:text/html,<h1>x</h1>'), false);
assert.equal(isNavigableBrowserUrl('vbscript:msgbox(1)'), false);
assert.equal(isNavigableBrowserUrl('codex://threads/abc'), false);
assert.equal(isNavigableBrowserUrl(''), false);
assert.equal(isNavigableBrowserUrl(null), false);
const browserSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'browser.js'), 'utf8');
assert.ok(browserSrc.includes('assertNavigableBrowserUrl(normalizeUrl(url))'), 'agent navigate() enforces the allowlist');
assert.ok(browserSrc.includes('if (isNavigableBrowserUrl(url))'), 'popup handler enforces the allowlist');
assert.ok(browserSrc.includes('setPermissionRequestHandler'), 'views deny device/data permissions');
assert.ok(browserSrc.includes('setPermissionCheckHandler'), 'views deny permission checks');

console.log('Browser URL normalization checks passed.');
