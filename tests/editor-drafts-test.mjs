import assert from 'node:assert/strict';
import { editorDraftStorageKey, findEditorDraft, hashEditorText, readEditorDrafts, restoreEditorDraft, writeEditorDrafts } from '../src/lib/editor-drafts.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) || null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const storage = new MemoryStorage();
const fileTab = (id, file) => ({ id, kind: 'file', title: id, file });
const tabs = [
  fileTab('dirty', { path: 'C:\\project\\src\\App.tsx', original: 'disk v1', content: 'draft v2', dirty: true }),
  fileTab('clean', { path: 'C:\\project\\README.md', original: 'same', content: 'same', dirty: false }),
  fileTab('readonly', { path: 'C:\\project\\preview.md', original: 'base', content: 'edit', dirty: true, readOnly: true }),
  { id: 'terminal', kind: 'terminal', title: 'Terminal' },
];

assert.deepEqual(writeEditorDrafts(tabs, 'dirty', storage), { savedCount: 1, omittedCount: 0 });
const drafts = readEditorDrafts(storage);
assert.equal(drafts.length, 1);
assert.equal(drafts[0].originalHash, hashEditorText('disk v1'));
assert.equal(findEditorDraft(drafts, 'c:/PROJECT/src/App.tsx')?.content, 'draft v2');
assert.equal(findEditorDraft(drafts, 'C:/project/missing.ts'), null);
assert.deepEqual(writeEditorDrafts(tabs, 'dirty', storage, 'C:\\project'), { savedCount: 1, omittedCount: 0 });
assert.equal(readEditorDrafts(storage, 'c:/PROJECT')[0]?.content, 'draft v2', 'draft scopes should ignore path case and slash style');
assert.deepEqual(readEditorDrafts(storage, 'C:/another-project'), [], 'drafts must not leak between workspaces');
const legacyDraftStorage = new MemoryStorage();
assert.deepEqual(writeEditorDrafts(tabs, 'dirty', legacyDraftStorage), { savedCount: 1, omittedCount: 0 });
assert.equal(readEditorDrafts(legacyDraftStorage, 'C:/project')[0]?.content, 'draft v2', 'legacy drafts should migrate into their matching workspace');
assert.deepEqual(readEditorDrafts(legacyDraftStorage, 'C:/another-project'), [], 'legacy drafts should not migrate into unrelated workspaces');
assert.deepEqual(writeEditorDrafts([], '', legacyDraftStorage, 'C:/project'), { savedCount: 0, omittedCount: 0 });
assert.deepEqual(readEditorDrafts(legacyDraftStorage, 'C:/project'), [], 'an empty scoped marker must prevent a stale legacy draft from returning');
assert.deepEqual(restoreEditorDraft('disk v1', null), {
  original: 'disk v1', content: 'disk v1', dirty: false, diskChanged: false,
});
assert.deepEqual(restoreEditorDraft('disk v1', drafts[0]), {
  original: 'disk v1', content: 'draft v2', dirty: true, diskChanged: false,
});
assert.deepEqual(restoreEditorDraft('disk v3', drafts[0]), {
  original: 'disk v1', content: 'draft v2', dirty: true, diskChanged: true,
});
const staleSavedDraft = { ...drafts[0], content: 'disk v1' };
assert.deepEqual(restoreEditorDraft('disk v1', staleSavedDraft), {
  original: 'disk v1', content: 'disk v1', dirty: false, diskChanged: false,
});

const oversized = fileTab('large', { path: 'large.ts', original: 'x'.repeat(700001), content: 'draft', dirty: true });
assert.deepEqual(writeEditorDrafts([oversized], 'large', storage), { savedCount: 0, omittedCount: 1 });
assert.deepEqual(readEditorDrafts(storage), [], 'clean snapshots should remove obsolete recovery data');

const corrupt = new MemoryStorage();
corrupt.setItem('mudex:editor-drafts:v1', '{');
assert.deepEqual(readEditorDrafts(corrupt), [], 'corrupt session data should not crash startup');
assert.equal(editorDraftStorageKey(''), 'mudex:editor-drafts:v1');
assert.equal(editorDraftStorageKey('C:\\P'), `mudex:editor-drafts:v1:${encodeURIComponent('c:/p')}`);

console.log('Editor draft recovery checks passed.');
