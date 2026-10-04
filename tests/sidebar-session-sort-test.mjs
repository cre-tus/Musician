import assert from 'node:assert/strict';
import {
  compareSidebarSessions,
  normalizeSidebarSessionSort,
  readSidebarSessionSort,
  writeSidebarSessionSort,
} from '../src/lib/sidebar-session-sort.mjs';

const sessions = [
  { id: 'c', title: 'Session 10', createdAt: 10, messages: [] },
  { id: 'a', title: 'beta', createdAt: 20, messages: [{ ts: 50 }] },
  { id: 'b', title: 'Alpha', createdAt: 30, messages: [{ ts: 50 }] },
];
assert.deepEqual([...sessions].sort((a, b) => compareSidebarSessions(a, b, 'recent')).map((s) => s.id), ['b', 'a', 'c']);
assert.deepEqual([...sessions].sort((a, b) => compareSidebarSessions(a, b, 'oldest')).map((s) => s.id), ['c', 'b', 'a']);
assert.deepEqual([...sessions].sort((a, b) => compareSidebarSessions(a, b, 'name')).map((s) => s.id), ['b', 'a', 'c']);
assert.equal(normalizeSidebarSessionSort('unexpected'), 'recent');

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
assert.equal(readSidebarSessionSort(storage), 'recent');
writeSidebarSessionSort('name', storage);
assert.equal(readSidebarSessionSort(storage), 'name');
values.set('mudex:sidebar-session-sort:v1', 'unexpected');
assert.equal(readSidebarSessionSort(storage), 'recent');
console.log('Sidebar session sort checks passed.');
