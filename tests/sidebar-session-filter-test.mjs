import assert from 'node:assert/strict';
import {
  countSidebarSessionFilters,
  filterSidebarSessions,
  isSidebarSessionFailed,
  normalizeSidebarSessionFilter,
  readSidebarSessionFilter,
  writeSidebarSessionFilter,
} from '../src/lib/sidebar-session-filter.mjs';

const sessions = [
  { id: 'a', pinned: true, messages: [] },
  { id: 'b', messages: [{ role: 'assistant', done: true, code: 1 }] },
  { id: 'c', messages: [{ role: 'assistant', done: true, code: 0 }] },
];
assert.deepEqual(filterSidebarSessions(sessions, 'all'), sessions);
assert.deepEqual(filterSidebarSessions(sessions, 'pinned').map((session) => session.id), ['a']);
assert.deepEqual(filterSidebarSessions(sessions, 'running', ['c']).map((session) => session.id), ['c']);
assert.deepEqual(filterSidebarSessions(sessions, 'failed').map((session) => session.id), ['b']);
assert.deepEqual(filterSidebarSessions(sessions, 'draft', [], ['a', 'c']).map((session) => session.id), ['a', 'c']);
assert.deepEqual(filterSidebarSessions(sessions, 'queued', [], [], ['b']).map((session) => session.id), ['b']);
assert.deepEqual(countSidebarSessionFilters(sessions, ['c'], ['a', 'c'], ['b']), { all: 3, pinned: 1, running: 1, failed: 1, draft: 2, queued: 1 });
assert.equal(isSidebarSessionFailed({ messages: [{ role: 'assistant', done: false, code: 1 }] }), false);
assert.equal(normalizeSidebarSessionFilter('unknown'), 'all');

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
assert.equal(readSidebarSessionFilter(storage), 'all');
writeSidebarSessionFilter('failed', storage);
assert.equal(readSidebarSessionFilter(storage), 'failed');
values.set('mudex:sidebar-session-filter:v1', 'unknown');
assert.equal(readSidebarSessionFilter(storage), 'all');
console.log('Sidebar session filter checks passed.');
