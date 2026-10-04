import assert from 'node:assert/strict';
import { normalizePinnedProjects, readPinnedProjects, togglePinnedProject, writePinnedProjects } from '../src/lib/pinned-projects.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage();
assert.deepEqual(normalizePinnedProjects([' C:\\Work\\Muse ', 'c:/work/muse/', '', null, 'D:/Music']), ['C:\\Work\\Muse', 'D:/Music']);
assert.deepEqual(togglePinnedProject(['C:\\Work\\Muse'], 'c:/work/muse/'), []);
assert.deepEqual(togglePinnedProject([], 'D:/Music'), ['D:/Music']);
assert.deepEqual(togglePinnedProject(['D:/Music'], ''), ['D:/Music']);
writePinnedProjects(['C:\\Work\\Muse', 'c:/work/muse/'], storage);
assert.deepEqual(readPinnedProjects(storage), ['C:\\Work\\Muse']);
storage.setItem('mudex:pinned-projects:v1', '{');
assert.deepEqual(readPinnedProjects(storage), []);

console.log('Pinned project checks passed.');
