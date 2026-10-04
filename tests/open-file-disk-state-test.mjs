import assert from 'node:assert/strict';
import { createUnavailableRestoredFile, reconcileOpenFileDiskState } from '../src/lib/open-file-disk-state.mjs';

const clean = { path: '/repo/a.ts', name: 'a.ts', original: 'old', content: 'old', dirty: false, showDiff: false };
assert.deepEqual(reconcileOpenFileDiskState(clean, { ok: true, content: 'new' }), {
  ...clean, original: 'new', content: 'new', dirty: false, diskState: undefined, externalContent: undefined,
});
const dirty = { ...clean, content: 'my edits', dirty: true };
assert.deepEqual(reconcileOpenFileDiskState(dirty, { ok: true, content: 'external edit' }), { ...dirty, diskState: 'changed', externalContent: 'external edit' });
assert.deepEqual(reconcileOpenFileDiskState({ ...dirty, diskState: 'changed', externalContent: 'external edit' }, { ok: true, content: 'old' }), { ...dirty, diskState: undefined, externalContent: undefined });
assert.deepEqual(reconcileOpenFileDiskState({ ...dirty, externalContent: 'external edit' }, { ok: false, error: 'FILE_MISSING' }), { ...dirty, diskState: 'missing', externalContent: undefined });
assert.deepEqual(reconcileOpenFileDiskState(dirty, { ok: false, error: 'ACCESS_DENIED' }), { ...dirty, diskState: 'unavailable', externalContent: undefined });
assert.deepEqual(createUnavailableRestoredFile('C:\\work\\lost.ts'), {
  path: 'C:\\work\\lost.ts', name: 'lost.ts', original: '', content: '', dirty: false, showDiff: false, diskState: 'unavailable',
});
assert.deepEqual(createUnavailableRestoredFile('/work/lost.ts', { original: 'disk', content: 'draft' }), {
  path: '/work/lost.ts', name: 'lost.ts', original: 'disk', content: 'draft', dirty: true, showDiff: false, diskState: 'unavailable',
});
assert.equal(reconcileOpenFileDiskState(clean, { ok: false, error: 'ACCESS_DENIED' }).diskState, 'unavailable');
assert.equal(reconcileOpenFileDiskState({ ...clean, diskState: 'unavailable' }, { ok: true, content: 'old' }).diskState, undefined);
console.log('Open-file external change checks passed.');
