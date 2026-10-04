import assert from 'node:assert/strict';
import {
  allVisibleSidebarSessionsSelected,
  selectSidebarSessionRange,
  selectVisibleSidebarSessions,
  toggleSidebarSessionSelection,
  visibleSidebarSessionSelection,
} from '../src/lib/sidebar-session-selection.mjs';

assert.deepEqual(toggleSidebarSessionSelection(['a'], 'b'), ['a', 'b']);
assert.deepEqual(toggleSidebarSessionSelection(['a', 'b'], 'a'), ['b']);
assert.deepEqual(selectSidebarSessionRange(['outside', 'a'], ['a', 'b', 'c', 'd'], 'a', 'c'), ['outside', 'a', 'b', 'c']);
assert.deepEqual(selectSidebarSessionRange(['d'], ['a', 'b', 'c', 'd'], 'd', 'b'), ['d', 'b', 'c']);
assert.deepEqual(selectSidebarSessionRange(['a'], ['a', 'b'], 'missing', 'b'), ['a', 'b']);
assert.deepEqual(selectVisibleSidebarSessions(['outside'], ['a', 'b'], true), ['outside', 'a', 'b']);
assert.deepEqual(selectVisibleSidebarSessions(['outside', 'a', 'b'], ['a', 'b'], false), ['outside']);
assert.deepEqual(visibleSidebarSessionSelection(['b', 'outside', 'a'], ['a', 'b']), ['a', 'b']);
assert.equal(allVisibleSidebarSessionsSelected(['a', 'outside', 'b'], ['a', 'b']), true);
assert.equal(allVisibleSidebarSessionsSelected(['a'], ['a', 'b']), false);
assert.equal(allVisibleSidebarSessionsSelected(['a'], []), false);
console.log('Sidebar session selection checks passed.');
