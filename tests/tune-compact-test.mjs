import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tune-dialog compact contract: the model/approval/reasoning modal is small,
// and reasoning effort is a Codex-style bar meter (one bar per concrete
// level, click to set) plus a CLI-default reset — not nine tall rows.
// The three setters keep their settings + live-session wiring.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const chat = read('src/components/ChatView.tsx');
const css = read('src/styles.css');
const pkg = JSON.parse(read('package.json'));
const blockOf = (sel) => {
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `${sel} styled`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${sel}`);
};

// 1. Reasoning is a bar meter with a visible selection, not rows.
assert.ok(chat.includes('tune-meter') && chat.includes('tune-bar'), 'meter chrome rendered');
assert.ok(chat.includes('role="radiogroup"') && chat.includes('role="radio"'), 'meter is a radiogroup');
assert.ok(chat.includes('tune-meter-reset'), 'CLI-default reset rendered');
assert.ok(chat.includes('tune-meter-value'), 'selected level shown');
assert.ok(chat.includes('tune-meter-scale'), 'endpoint scale shown');
assert.ok(/changeReasoning\(v\)/.test(chat), 'bars call changeReasoning');
console.log('ok - reasoning bar meter');

// 2. Compact chrome.
const card = blockOf('.tune-card {');
const cardWidth = Number((card.match(/width:\s*(\d+)px/) || [])[1]);
assert.ok(cardWidth > 0 && cardWidth <= 248, `tune card compact, saw ${cardWidth}px`);
const cardRadius = Number((card.match(/border-radius:\s*(\d+)px/) || [])[1]);
assert.ok(cardRadius > 0 && cardRadius <= 14, `tune card radius restrained, saw ${cardRadius}px`);
const row = blockOf('.tune-row {');
assert.ok(/padding:\s*4px 6px/.test(row), 'tune rows compact padding');
assert.ok(/font-size:\s*12px/.test(row), 'tune rows compact type');
const rowActive = blockOf('.tune-row.active {');
assert.ok(rowActive.includes('background:'), 'selected row is a pill');
assert.ok(blockOf('.tune-bar {').includes('background:'), 'bars styled');
assert.ok(blockOf('.tune-bar.on {').length > 0, 'active bar styled');
assert.ok(blockOf('.tune-bar.lit {').length > 0, 'level fill styled');
console.log('ok - compact chrome');

// 3. All three setters keep settings + live-session wiring.
for (const [fn, key, live] of [
  ['changeModel', 'model', 'mspSetModel'],
  ['changeApproval', 'approvalMode', 'mspSetApprovalMode'],
  ['changeReasoning', 'reasoningEffort', 'mspSetReasoning'],
]) {
  assert.ok(chat.includes(`const ${fn} =`), `${fn} defined`);
  assert.ok(chat.includes(`onPatchSettings({ ${key}:`) || chat.includes(`onPatchSettings({${key}:`), `${fn} patches settings`);
  assert.ok(chat.includes(live), `${fn} live-updates the session`);
}
console.log('ok - setter wiring');

// 4. Suite wiring.
assert.ok((pkg.scripts.test || '').includes('tune-compact:test'), 'test chain includes tune-compact');
assert.equal(pkg.scripts['tune-compact:test'], 'node tests/tune-compact-test.mjs');
console.log('ok - suite wiring');

console.log('TUNE COMPACT TEST: ALL PASS');
