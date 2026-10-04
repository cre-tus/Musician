import assert from 'node:assert/strict';
import { saveFilesSequentially } from '../src/lib/save-file-batch.mjs';

const files = [{ name: 'one.ts' }, { name: 'two.ts' }, { name: 'three.ts' }];
const attempted = [];
const result = await saveFilesSequentially(files, async (file) => {
  attempted.push(file.name);
  if (file.name === 'two.ts') return false;
  return true;
});
assert.deepEqual(attempted, ['one.ts', 'two.ts', 'three.ts']);
assert.deepEqual(result.saved.map((file) => file.name), ['one.ts', 'three.ts']);
assert.deepEqual(result.failed.map((file) => file.name), ['two.ts']);

const thrown = await saveFilesSequentially(files.slice(0, 2), async (file) => {
  if (file.name === 'one.ts') throw new Error('write failed');
  return true;
});
assert.deepEqual(thrown.failed.map((file) => file.name), ['one.ts']);
assert.deepEqual(thrown.saved.map((file) => file.name), ['two.ts']);
console.log('Sequential save batch checks passed.');
