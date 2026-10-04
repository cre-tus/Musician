import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Chat header overlap regression: .chat-title is a flex item with a long
// untruncated min-content. Without min-width: 0 it pushes the sibling
// .chat-workspace button past the chat pane, covering the pane tab strip
// (measured: copy button 811-859 over 파일 tab 805-862 at 1440px).
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const block = css.match(/^\.chat-title \{([^}]*)\}/m);
assert.ok(block, '.chat-title rule exists');
assert.ok(/min-width:\s*0/.test(block[1]), '.chat-title has min-width: 0 so ellipsis can shrink it');
console.log('ok - .chat-title shrinks inside the flex header');

// The heading already constrains itself; lock that in too.
const heading = css.match(/^\.chat-heading \{([^}]*)\}/m);
assert.ok(heading && /min-width:\s*0/.test(heading[1]), '.chat-heading keeps min-width: 0');
console.log('ok - .chat-heading constrained');

console.log('HEADER OVERLAP TEST: ALL PASS');
