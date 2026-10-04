import assert from 'node:assert/strict';
import {
  defaultFileSearchPreferences,
  fileSearchPreferencesKey,
  readFileSearchPreferences,
  writeFileSearchPreferences,
} from '../src/lib/file-search-preferences.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage();
const projectA = 'C:\\Projects\\A';
const projectB = 'C:\\Projects\\B';
const preferences = { include: 'src/**/*.ts', exclude: '**/*.test.ts', caseSensitive: true, wholeWord: true, filtersOpen: true };

assert.deepEqual(readFileSearchPreferences(projectA, storage), defaultFileSearchPreferences());
assert.equal(writeFileSearchPreferences(projectA, preferences, storage), true);
assert.deepEqual(readFileSearchPreferences('c:/projects/a/', storage), preferences);
assert.deepEqual(readFileSearchPreferences(projectB, storage), defaultFileSearchPreferences());
assert.notEqual(fileSearchPreferencesKey(projectA), fileSearchPreferencesKey(projectB));
assert.deepEqual(readFileSearchPreferences('', storage), defaultFileSearchPreferences());

console.log('Project file search preference checks passed.');
