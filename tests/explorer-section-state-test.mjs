import assert from 'node:assert/strict';
import { EXPLORER_SECTIONS, explorerSectionStorageKey, readExplorerSectionState, toggleExplorerSection, writeExplorerSectionState } from '../src/lib/explorer-section-state.mjs';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const ALL_OPEN = { open: true, pinned: true, recent: true, changed: true };

assert.deepEqual(EXPLORER_SECTIONS, ['open', 'pinned', 'recent', 'changed']);
assert.deepEqual(readExplorerSectionState('C:\\Project', storage), ALL_OPEN);
assert.deepEqual(readExplorerSectionState('', storage), ALL_OPEN);
assert.equal(explorerSectionStorageKey('C:\\Project'), explorerSectionStorageKey('c:/project/'));

assert.equal(writeExplorerSectionState('C:\\Project', { ...ALL_OPEN, open: false, changed: false }, storage), true);
assert.deepEqual(readExplorerSectionState('c:/project/', storage), { open: false, pinned: true, recent: true, changed: false });
// Other projects keep their own state.
assert.deepEqual(readExplorerSectionState('C:\\Other', storage), ALL_OPEN);
assert.equal(writeExplorerSectionState('', ALL_OPEN, storage), false);

const toggled = toggleExplorerSection(ALL_OPEN, 'recent');
assert.deepEqual(toggled, { ...ALL_OPEN, recent: false });
assert.deepEqual(toggleExplorerSection(toggled, 'recent'), ALL_OPEN);
assert.equal(toggleExplorerSection(ALL_OPEN, 'bogus'), ALL_OPEN);

values.set(explorerSectionStorageKey('broken'), '{');
assert.deepEqual(readExplorerSectionState('broken', storage), ALL_OPEN);
values.set(explorerSectionStorageKey('partial'), JSON.stringify({ open: false }));
assert.deepEqual(readExplorerSectionState('partial', storage), { ...ALL_OPEN, open: false });

console.log('Explorer section state checks passed.');
