import assert from 'node:assert/strict';
import { normalizePinnedFilePath, pinnedFileParentDirectories, pinnedFileStorageKey, readPinnedFilePaths, reconcilePinnedFilePaths, removePinnedFilePaths, renamePinnedFilePaths } from '../src/lib/pinned-file-paths.mjs';

assert.equal(normalizePinnedFilePath('C:\\Work\\src\\File.ts'), 'c:/work/src/file.ts');
assert.equal(pinnedFileStorageKey('C:\\Work\\'), 'mudex:pinned-files:v1:c:/work');
const pinnedValues = new Map([['mudex:pinned-files:v1:c:/work', JSON.stringify(['C:\\Work\\src\\a.ts', 'c:/work/src/A.TS', 'C:/Elsewhere/x.ts'])]]);
assert.deepEqual(readPinnedFilePaths('C:/Work', { getItem: (key) => pinnedValues.get(key) || null }), ['C:\\Work\\src\\a.ts']);
assert.deepEqual(removePinnedFilePaths([
  'C:\\Work\\src\\a.ts',
  'C:\\Work\\src-old\\b.ts',
  'C:\\Work\\keep.ts',
], 'c:/work/src', true), ['C:\\Work\\src-old\\b.ts', 'C:\\Work\\keep.ts']);
assert.deepEqual(removePinnedFilePaths(['C:\\Work\\src\\a.ts', 'C:\\Work\\src\\b.ts'], 'c:/work/src/a.ts'), ['C:\\Work\\src\\b.ts']);
assert.deepEqual(renamePinnedFilePaths([
  'C:\\Work\\src\\a.ts',
  'C:\\Work\\src\\nested\\b.ts',
  'C:\\Work\\src-other\\c.ts',
], 'C:\\Work\\src', 'C:\\Work\\lib', true), [
  'C:\\Work\\lib\\a.ts',
  'C:\\Work\\lib\\nested\\b.ts',
  'C:\\Work\\src-other\\c.ts',
]);
assert.deepEqual(renamePinnedFilePaths(['C:\\Work\\A.ts', 'c:/work/a.TS'], 'C:/Work/A.ts', 'C:/Work/B.ts'), ['C:/Work/B.ts']);
assert.deepEqual(pinnedFileParentDirectories(['C:\\Work\\src\\a.ts', 'C:/Work/src/b.ts', 'C:\\Work\\README.md'], 'C:\\Work'), ['C:\\Work', 'C:\\Work\\src']);

const tree = new Map([
  ['C:/Work', { ok: true, entries: [
    { name: 'src', path: 'C:/Work/src', isDir: true },
    { name: 'README.md', path: 'C:/Work/README.md', isDir: false },
  ] }],
  ['C:/Work/src', { ok: true, entries: [
    { name: 'live.ts', path: 'C:/Work/src/live.ts', isDir: false },
    { name: 'nested', path: 'C:/Work/src/nested', isDir: true },
  ] }],
  ['C:/Work/src/nested', { ok: true, entries: [] }],
]);
const requestedDirectories = [];
const reconciled = await reconcilePinnedFilePaths([
  'C:\\Work\\src\\live.ts',
  'C:\\Work\\src\\gone.ts',
  'C:\\Work\\src\\nested\\gone.ts',
  'C:\\Work\\README.md',
  'C:\\Elsewhere\\keep.ts',
], 'C:\\Work', async (directory) => {
  requestedDirectories.push(directory);
  return tree.get(directory.replace(/\\/g, '/')) || { ok: false, error: 'ACCESS_DENIED' };
});
assert.deepEqual(reconciled, ['C:\\Work\\src\\live.ts', 'C:\\Work\\README.md', 'C:\\Elsewhere\\keep.ts']);
assert.equal(requestedDirectories.filter((directory) => normalizePinnedFilePath(directory) === 'c:/work').length, 1, 'directory listings should be cached');
assert.deepEqual(await reconcilePinnedFilePaths(['C:\\Work\\src\\maybe.ts'], 'C:\\Work', async () => ({ ok: false, error: 'ACCESS_DENIED' })), ['C:\\Work\\src\\maybe.ts'], 'uncertain filesystem errors must not delete favorites');
console.log('Pinned file path cleanup checks passed.');
