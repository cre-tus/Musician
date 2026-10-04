import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEditorPosition } from '../src/lib/editor-position.mjs';

// Go-to-line popover: the input's native `pattern` must agree with the
// parser + placeholder ("42" and "42:8" both submittable). A pattern of
// [0-9]* silently blocks every line:column submission (native validation
// rejects before the submit handler runs).
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/components/RightPane.tsx'), 'utf8');

const match = source.match(/id="go-to-line-input"[\s\S]*?pattern="([^"]+)"/);
assert.ok(match, 'go-to-line input has a pattern attribute');
const pattern = new RegExp(`^(?:${match[1]})$`);
console.log(`pattern under test: ${match[1]}`);

// 1. The documented shapes submit.
assert.ok(pattern.test('42'), 'plain line passes native validation');
assert.ok(pattern.test('42:8'), 'line:column passes native validation');
console.log('ok - documented shapes pass');

// 2. One-directional agreement: everything the parser accepts must pass
// native validation (never silently blocked). The reverse is allowed —
// pattern-lenient values like "0" reach the parser and get a notice.
const cases = ['1', '42', '42:8', '7:1', ' 42 ', '999:999'];
for (const value of cases) {
  assert.ok(parseEditorPosition(value) !== null, `parser accepts ${JSON.stringify(value)}`);
  assert.ok(pattern.test(value.trim()), `pattern accepts ${JSON.stringify(value)}`);
}
console.log('ok - parser-valid values pass native validation');

// 3. Garbage stays blocked (or parser-rejected with a notice, never moved).
assert.equal(pattern.test('abc'), false);
assert.equal(parseEditorPosition('abc'), null);
assert.equal(parseEditorPosition(''), null);
console.log('ok - garbage rejected');

console.log('GOTO LINE TEST: ALL PASS');
