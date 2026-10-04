import assert from 'node:assert/strict';
import { ensureFilesTabFallback, unpinnedPaneTabIds } from '../src/lib/pane-tab-management.mjs';

const tabs = [
  { id: 'pinned-file', pinned: true },
  { id: 'browser' },
  { id: 'pinned-terminal', pinned: true },
  { id: 'file' },
];
assert.deepEqual(unpinnedPaneTabIds(tabs), ['browser', 'file']);
assert.deepEqual(unpinnedPaneTabIds([]), []);
assert.deepEqual(unpinnedPaneTabIds([{ id: 'all-pinned', pinned: true }]), []);

const filesTab = { id: 'files-fallback', kind: 'files', title: '파일' };
assert.deepEqual(ensureFilesTabFallback([], () => filesTab), [filesTab], 'empty tabset falls back to Files');
assert.deepEqual(ensureFilesTabFallback(null, () => filesTab), [filesTab], 'missing tabset falls back to Files');
assert.equal(ensureFilesTabFallback(tabs, () => { throw new Error('must not create'); }), tabs, 'non-empty tabset untouched');
console.log('Unpinned tab selection checks passed.');
