import assert from 'node:assert/strict';
import { normalizeCommitMessage, porcelainPath, porcelainStaged, porcelainStatus } from '../src/lib/git-status.mjs';

const examples = [
  [' M src/app.ts', 'src/app.ts', 'M'],
  ['M  src/app.ts', 'src/app.ts', 'M'],
  ['?? new file.ts', 'new file.ts', 'U'],
  ['A  added.ts', 'added.ts', 'A'],
  ['D  deleted.ts', 'deleted.ts', 'D'],
  ['R  old.ts -> new.ts', 'new.ts', 'R'],
  ['UU conflict.ts', 'conflict.ts', 'C'],
  ['AA conflict.ts', 'conflict.ts', 'C'],
  [' T type-change.ts', 'type-change.ts', 'T'],
];

for (const [entry, expectedPath, expectedStatus] of examples) {
  assert.equal(porcelainPath(entry), expectedPath, `path: ${entry}`);
  assert.equal(porcelainStatus(entry), expectedStatus, `status: ${entry}`);
}

const stagedCases = [
  ['M  src/app.ts', true],
  [' M src/app.ts', false],
  ['MM both.ts', true],
  ['A  added.ts', true],
  ['AM added-modified.ts', true],
  [' D deleted.ts', false],
  ['D  deleted-staged.ts', true],
  ['R  old.ts -> new.ts', true],
  [' R renamed-unstaged.ts', false],
  ['?? new file.ts', false],
  ['UU conflict.ts', true],
  [' T type-change.ts', false],
  ['T  type-staged.ts', true],
  ['', false],
  ['M', false],
];
for (const [entry, expected] of stagedCases) {
  assert.equal(porcelainStaged(entry), expected, `staged: ${entry}`);
}

assert.deepEqual(normalizeCommitMessage('  hello  '), { ok: true, message: 'hello' });
assert.deepEqual(normalizeCommitMessage('   '), { ok: false, error: 'EMPTY_MESSAGE' });
assert.deepEqual(normalizeCommitMessage('x'.repeat(2001)), { ok: false, error: 'MESSAGE_TOO_LONG' });
assert.equal(normalizeCommitMessage('x'.repeat(2000)).ok, true);

console.log('Git porcelain status checks passed.');
