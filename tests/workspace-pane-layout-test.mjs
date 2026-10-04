import assert from 'node:assert/strict';
import { mergeLiveWorkspaceTabs, readWorkspacePaneLayout, removeTabFromStoredWorkspaceLayouts, serializeWorkspacePaneLayout, workspacePaneLayoutKey, writeWorkspacePaneLayout } from '../src/lib/workspace-pane-layout.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) || null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] || null; }
}

const storage = new MemoryStorage();
const projectA = 'C:\\work\\alpha';
const projectB = 'C:\\work\\beta';
const tabsA = [
  { id: 'file-a', kind: 'file', title: 'App.tsx', pinned: true, file: { path: 'C:\\work\\alpha\\src\\App.tsx', content: 'secret', dirty: true } },
  { id: 'files-a', kind: 'files', title: '파일' },
  { id: 'preview-a', kind: 'file', title: 'image.png', file: { path: 'image.png', readOnly: true } },
];
const tabsB = [{ id: 'browser-b', kind: 'browser', title: 'Docs', url: 'https://example.com' }];

const serialized = serializeWorkspacePaneLayout(projectA, tabsA, 'file-a');
assert.equal(serialized.tabs.length, 2, 'read-only preview contents are ephemeral');
assert.equal(JSON.stringify(serialized).includes('secret'), false, 'layout metadata must never persist editor contents');
assert.equal(workspacePaneLayoutKey('c:/WORK/alpha'), workspacePaneLayoutKey(projectA));
assert.equal(writeWorkspacePaneLayout(projectA, tabsA, 'file-a', storage), true);
assert.equal(writeWorkspacePaneLayout(projectB, tabsB, 'browser-b', storage), true);
assert.deepEqual(readWorkspacePaneLayout(projectA, storage)?.tabs, serialized.tabs);
assert.equal(readWorkspacePaneLayout(projectB, storage)?.tabs[0].id, 'browser-b');
assert.equal(readWorkspacePaneLayout('C:\\work\\gamma', storage), null, 'another workspace must not inherit the last global layout');
const liveTerminal = { id: 'term-live', kind: 'terminal', title: 'Running shell', cwd: projectA };
const mergeResult = mergeLiveWorkspaceTabs([{ id: 'files-b', kind: 'files', title: 'Files' }], [liveTerminal, { id: 'ignored-file', kind: 'file' }]);
assert.deepEqual(mergeResult.map((tab) => tab.id), ['files-b', 'term-live'], 'switching projects must preserve running terminal tabs');

const legacy = new MemoryStorage();
legacy.setItem('mudex:folder:v1', projectA);
legacy.setItem('mudex:pane-layout:v1', JSON.stringify({ tabs: [{ id: 'legacy' }] }));
assert.equal(readWorkspacePaneLayout(projectA, legacy)?.tabs[0].id, 'legacy');
assert.equal(readWorkspacePaneLayout(projectB, legacy), null, 'legacy tabs only migrate into their original workspace');

// Closing a tab must purge it from every stored workspace layout, or a
// session switch rehydrates the stale entry (closed browser tab resurrection).
const shared = { id: 'browser-shared', kind: 'browser', title: 'Shared', url: 'https://example.com' };
const purgeStore = new MemoryStorage();
assert.equal(writeWorkspacePaneLayout(projectA, [shared, { id: 'file-a', kind: 'file', title: 'App.tsx', file: { path: 'a' } }], 'browser-shared', purgeStore), true);
assert.equal(writeWorkspacePaneLayout(projectB, [shared], 'browser-shared', purgeStore), true);
assert.equal(removeTabFromStoredWorkspaceLayouts('browser-shared', purgeStore), true);
assert.deepEqual((readWorkspacePaneLayout(projectA, purgeStore)?.tabs || []).map((t) => t.id), ['file-a'], 'sibling tabs survive the purge');
assert.deepEqual(readWorkspacePaneLayout(projectB, purgeStore)?.tabs || [], [], 'stale workspace drops the closed tab');
assert.equal(removeTabFromStoredWorkspaceLayouts('browser-shared', purgeStore), false, 'second purge is a no-op');
assert.equal(removeTabFromStoredWorkspaceLayouts('no-such-tab', purgeStore), false);
const corrupt = new MemoryStorage();
corrupt.setItem('mudex:pane-layout:v1', '{oops');
assert.equal(removeTabFromStoredWorkspaceLayouts('x', corrupt), false, 'corrupt entries are skipped');
console.log('Workspace pane layout isolation checks passed.');
