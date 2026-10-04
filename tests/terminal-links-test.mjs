import assert from 'node:assert/strict';
import { findTerminalLinks } from '../src/lib/terminal-links.mjs';

// Bare URLs with 1-based columns for xterm ranges.
assert.deepEqual(findTerminalLinks('open https://example.com/a?b=1 now'), [
  { start: 6, end: 31, url: 'https://example.com/a?b=1' },
]);
assert.deepEqual(findTerminalLinks('http://x.io'), [{ start: 1, end: 12, url: 'http://x.io' }]);

// Trailing punctuation is trimmed, balanced parens survive.
assert.deepEqual(findTerminalLinks('see (https://a.bc/x_(1)) ok'), [
  { start: 6, end: 24, url: 'https://a.bc/x_(1)' },
]);
assert.deepEqual(findTerminalLinks('go https://a.bc/x, then.'), [
  { start: 4, end: 18, url: 'https://a.bc/x' },
]);
assert.deepEqual(findTerminalLinks('url: "https://a.bc/x";'), [
  { start: 7, end: 21, url: 'https://a.bc/x' },
]);

// Multiple links per line, capped for paint performance.
const many = Array.from({ length: 12 }, (_, i) => `https://a.bc/${i}`).join(' ');
assert.equal(findTerminalLinks(many).length, 8);
assert.equal(findTerminalLinks(many, 2).length, 2);

// Non-URLs stay text.
assert.deepEqual(findTerminalLinks('C:\\Users\\someone\\file.txt'), []);
assert.deepEqual(findTerminalLinks('just words ftp://x'), []);
assert.deepEqual(findTerminalLinks(''), []);
assert.deepEqual(findTerminalLinks(null), []);
assert.deepEqual(findTerminalLinks('https://'), []);

console.log('Terminal links passed.');
