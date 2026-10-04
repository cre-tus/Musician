import assert from 'node:assert/strict';
import { parseEditorPosition } from '../src/lib/editor-position.mjs';

assert.deepEqual(parseEditorPosition('42'), { line: 42, column: 1 });
assert.deepEqual(parseEditorPosition(' 42:8 '), { line: 42, column: 8 });
assert.equal(parseEditorPosition(''), null);
assert.equal(parseEditorPosition('0'), null);
assert.equal(parseEditorPosition('3:0'), null);
assert.equal(parseEditorPosition('3:4:5'), null);
assert.equal(parseEditorPosition('line 3'), null);
assert.equal(parseEditorPosition('9007199254740992'), null);
console.log('Editor position parsing checks passed.');
