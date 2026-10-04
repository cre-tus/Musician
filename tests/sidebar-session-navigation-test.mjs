import assert from 'node:assert/strict';
import { adjacentSessionIndex } from '../src/lib/sidebar-session-navigation.mjs';

assert.equal(adjacentSessionIndex(1, 4, 'ArrowDown'), 2);
assert.equal(adjacentSessionIndex(1, 4, 'ArrowUp'), 0);
assert.equal(adjacentSessionIndex(3, 4, 'ArrowDown'), 3);
assert.equal(adjacentSessionIndex(0, 4, 'ArrowUp'), 0);
assert.equal(adjacentSessionIndex(-1, 4, 'ArrowDown'), 0);
assert.equal(adjacentSessionIndex(-1, 4, 'ArrowUp'), 0);
assert.equal(adjacentSessionIndex(1, 4, 'Home'), 0);
assert.equal(adjacentSessionIndex(1, 4, 'End'), 3);
assert.equal(adjacentSessionIndex(0, 0, 'ArrowDown'), null);
assert.equal(adjacentSessionIndex(0, 2, 'Escape'), null);

console.log('Sidebar session navigation checks passed.');
