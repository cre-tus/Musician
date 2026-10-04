import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Selection toolbar wrap regression: .session-selection-bar holds 7 items
// (toggle + count + 5 actions) in a ~282px sidebar. With nowrap + hidden
// scrollbar the trailing 고정/보관/삭제 buttons are clipped and unreachable
// (measured: 삭제 at x 340-372, painted over by the chat pane).
// flex-wrap: wrap keeps every action visible without scrolling.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const block = css.match(/^\.session-selection-bar \{([^}]*)\}/m);
assert.ok(block, '.session-selection-bar rule exists');
assert.ok(/flex-wrap:\s*wrap/.test(block[1]), '.session-selection-bar wraps so all actions stay visible');
console.log('ok - .session-selection-bar wraps inside the narrow sidebar');

console.log('SELECTION BAR WRAP TEST: ALL PASS');
