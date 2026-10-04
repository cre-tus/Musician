import assert from 'node:assert/strict';
import { shortcutGroupId, splitShortcutKeys } from '../src/lib/shortcut-display.mjs';

// Single chord stays one chip.
assert.deepEqual(splitShortcutKeys('Ctrl+S'), [{ type: 'keys', text: 'Ctrl+S' }]);

// Alternatives split into separate chips with separators.
assert.deepEqual(splitShortcutKeys('Ctrl+Shift+P / Ctrl+K'), [
  { type: 'keys', text: 'Ctrl+Shift+P' },
  { type: 'sep', text: '/' },
  { type: 'keys', text: 'Ctrl+K' },
]);

// Middle-dot separators (multi-step moves) also split.
assert.deepEqual(splitShortcutKeys('↑ / ↓ · ← / →'), [
  { type: 'keys', text: '↑' },
  { type: 'sep', text: '/' },
  { type: 'keys', text: '↓' },
  { type: 'sep', text: '·' },
  { type: 'keys', text: '←' },
  { type: 'sep', text: '/' },
  { type: 'keys', text: '→' },
]);

// Context notes stay attached to their chord.
assert.deepEqual(splitShortcutKeys('Ctrl+Alt+PageUp / PageDown'), [
  { type: 'keys', text: 'Ctrl+Alt+PageUp' },
  { type: 'sep', text: '/' },
  { type: 'keys', text: 'PageDown' },
]);

// Empty / junk input yields no chips.
assert.deepEqual(splitShortcutKeys(''), []);
assert.deepEqual(splitShortcutKeys('   '), []);
assert.deepEqual(splitShortcutKeys(null), []);

// Only whitespace-surrounded separators split: a leading slash stays part
// of the chord, so slash commands render as one chip.
assert.deepEqual(splitShortcutKeys('/'), [{ type: 'keys', text: '/' }]);
assert.deepEqual(splitShortcutKeys('/new'), [{ type: 'keys', text: '/new' }]);
assert.deepEqual(splitShortcutKeys('Ctrl+S /'), [
  { type: 'keys', text: 'Ctrl+S' },
]);

// Group ids are index-based: no spaces, always valid for aria-labelledby.
assert.equal(shortcutGroupId(0), 'shortcuts-group-0');
assert.equal(shortcutGroupId(2), 'shortcuts-group-2');
assert.match(shortcutGroupId(1), /^shortcuts-group-\d+$/);

console.log('Shortcut display passed.');
