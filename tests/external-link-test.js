'use strict';

const assert = require('node:assert/strict');
const { normalizeExternalLink } = require('../electron/external-link');

assert.equal(normalizeExternalLink('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
assert.equal(normalizeExternalLink('mailto:help@example.com'), 'mailto:help@example.com');
assert.equal(normalizeExternalLink('javascript:alert(1)'), null);
assert.equal(normalizeExternalLink('file:///C:/Windows/win.ini'), null);
assert.equal(normalizeExternalLink('https://user:pass@example.com'), null);
assert.equal(normalizeExternalLink('/relative/path'), null);

console.log('External link allowlist checks passed.');
