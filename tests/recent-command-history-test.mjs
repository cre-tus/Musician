import assert from 'node:assert/strict';
import { normalizeRecentCommandIds, readRecentCommandIds, recordRecentCommand, writeRecentCommandIds } from '../src/lib/recent-command-history.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage();
assert.deepEqual(normalizeRecentCommandIds(['a', 'b', 'a', '', null, 'c'], 3), ['a', 'b', 'c']);
assert.deepEqual(recordRecentCommand(['a', 'b', 'a'], 'b'), ['b', 'a']);
assert.deepEqual(recordRecentCommand(['a', 'b'], 'c', 2), ['c', 'a']);
assert.deepEqual(recordRecentCommand(['a'], 'x'.repeat(241)), ['a']);
writeRecentCommandIds(['settings', 'new', 'settings'], storage);
assert.deepEqual(readRecentCommandIds(storage), ['settings', 'new']);
writeRecentCommandIds([], storage);
assert.deepEqual(readRecentCommandIds(storage), []);
storage.setItem('mudex:recent-commands:v1', '{');
assert.deepEqual(readRecentCommandIds(storage), []);

console.log('Recent command history checks passed.');
