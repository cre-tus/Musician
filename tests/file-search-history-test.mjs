import assert from 'node:assert/strict';
import {
  fileSearchHistoryKey,
  normalizeFileSearchHistory,
  readFileSearchHistory,
  recordFileSearchQuery,
  writeFileSearchHistory,
} from '../src/lib/file-search-history.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage();
const projectA = 'C:\\Projects\\A';
const projectB = 'C:\\Projects\\B';
let history = recordFileSearchQuery([], '  useState  ', 'content');
history = recordFileSearchQuery(history, 'App.tsx', 'name');
history = recordFileSearchQuery(history, 'usestate', 'content');
assert.deepEqual(history, [
  { query: 'usestate', mode: 'content' },
  { query: 'App.tsx', mode: 'name' },
]);
assert.equal(writeFileSearchHistory(projectA, history, storage), true);
assert.deepEqual(readFileSearchHistory('c:/projects/a/', storage), history);
assert.deepEqual(readFileSearchHistory(projectB, storage), []);
assert.notEqual(fileSearchHistoryKey(projectA), fileSearchHistoryKey(projectB));
assert.deepEqual(normalizeFileSearchHistory([{ query: 'bad', mode: 'regex' }, null, { query: 'ok', mode: 'name' }]), [
  { query: 'ok', mode: 'name' },
]);

console.log('Project file search history checks passed.');
