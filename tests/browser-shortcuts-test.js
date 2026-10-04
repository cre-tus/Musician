'use strict';

const assert = require('node:assert/strict');
const { browserTabShortcut } = require('../electron/browser-shortcuts');

assert.equal(browserTabShortcut({ type: 'keyDown', key: 'l', control: true }), 'focus-address');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'f', meta: true }), 'find-in-page');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'p', control: true }), 'quick-open');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'p', control: true, shift: true }), 'command-palette');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'k', meta: true }), 'command-palette');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 't', control: true, shift: true }), 'reopen-closed-file');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'f', control: true, shift: true }), 'find-in-files');
assert.equal(browserTabShortcut({ type: 'keyDown', key: '3', control: true }), 'select-tab-3');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'e', control: true, shift: true }), 'open-explorer');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'b', control: true }), 'toggle-sidebar');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'e', control: true, alt: true }), 'toggle-editor');
assert.equal(browserTabShortcut({ type: 'keyDown', key: ',', code: 'Comma', control: true }), 'open-settings');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'w', control: true }), 'close-tab');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'w', control: true, shift: true }), 'close-all-tabs');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'Tab', control: true }), 'recent-tab-next');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'Tab', control: true, shift: true }), 'recent-tab-previous');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'PageDown', control: true }), 'ordered-tab-right');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'PageUp', meta: true }), 'ordered-tab-left');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'PageDown', control: true, shift: true }), 'move-tab-right');
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'PageUp', control: true, shift: true }), 'move-tab-left');
assert.equal(browserTabShortcut({ type: 'char', key: 'w', control: true }), null);
assert.equal(browserTabShortcut({ type: 'keyDown', key: 'w' }), null);

console.log('Browser tab shortcut mapping checks passed.');
