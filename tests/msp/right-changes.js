'use strict';
// Right-pane changed-files test: the editor (right) side must list the
// folder's git changes and open a diff on click, like the chat chips do.
// Exit 0 = ALL PASS, exit 1 = FAIL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Extracts one brace-matched function verbatim so the test executes the
// shipped implementation instead of a retyped copy.
function extractFn(src, start) {
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, 'function body found');
  let depth = 0;
  let quote = null;
  let esc = false;
  let lineC = false;
  let blockC = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const n = src[j + 1];
    if (lineC) {
      if (c === '\n') lineC = false;
      continue;
    }
    if (blockC) {
      if (c === '*' && n === '/') {
        blockC = false;
        j++;
      }
      continue;
    }
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') {
      lineC = true;
      j++;
      continue;
    }
    if (c === '/' && n === '*') {
      blockC = true;
      j++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1).replace(/^export\s+/, '');
    }
  }
  throw new Error('unbalanced braces in target function');
}

// 1. porcelainPath: functional test against the shipped parser module
// (re-exported to the renderer through lib/mudex).
const parserSrc = read('src/lib/git-status.mjs');
const marker = 'export function porcelainPath(';
const at = parserSrc.indexOf(marker);
assert.ok(at >= 0, 'porcelainPath defined in git-status.mjs');
// Plain JS module: extractFn already strips the leading `export `.
const fnSrc = extractFn(parserSrc, at);
const porcelainPath = new Function(`${fnSrc}\nreturn porcelainPath;`)();
assert.equal(typeof porcelainPath, 'function', 'porcelainPath exported from git-status.mjs');
const tsSrc = read('src/lib/mudex.ts');
assert.ok(tsSrc.includes('porcelainPath') && tsSrc.includes('git-status.mjs'), 'porcelainPath re-exported from lib/mudex');
assert.equal(porcelainPath('M src/App.tsx'), 'src/App.tsx', 'unstaged (trimmed)');
assert.equal(porcelainPath(' M src/App.tsx'), 'src/App.tsx', 'unstaged (raw)');
assert.equal(porcelainPath('M  staged.txt'), 'staged.txt', 'staged');
assert.equal(porcelainPath('?? new.txt'), 'new.txt', 'untracked');
assert.equal(porcelainPath('A  added.txt'), 'added.txt', 'added');
assert.equal(porcelainPath('R  old.ts -> new.ts'), 'new.ts', 'rename takes new path');
assert.equal(porcelainPath(''), '', 'empty stays empty');
console.log('ok - porcelainPath parses trimmed + raw porcelain lines');

// 2. wiring: chat chips use the same parser (no first-char-eating slice).
const chat = read('src/components/ChatView.tsx');
assert.ok(/porcelainPath/.test(chat), 'ChatView diffPaths uses porcelainPath');
assert.ok(!/e\.slice\(3\)/.test(chat), 'ChatView no longer uses slice(3)');
console.log('ok - chat chips share the parser');

// 3. wiring: right pane lists changes, refreshes on chat-done, opens diffs.
const filesTab = read('src/components/FilesTab.tsx');
assert.ok(/changed-section/.test(filesTab), 'FilesTab renders a changed section');
assert.ok(/onOpenChanged/.test(filesTab), 'FilesTab opens a diff on item click');
assert.ok(/onRefreshChanged/.test(filesTab), 'FilesTab has a manual refresh');
const rightPane = read('src/components/RightPane.tsx');
assert.ok(/changedFiles/.test(rightPane), 'RightPane forwards changedFiles');
const appView = read('src/App.tsx');
assert.ok(/gitStatus/.test(appView), 'App refreshes git status for the folder');
assert.ok(/onChatDone/.test(appView), 'App refreshes changes when a chat finishes');
assert.ok(/changedFiles=/.test(appView), 'App passes changedFiles to RightPane');
console.log('ok - right pane changed list + refresh + diff wiring');

console.log('MSP RIGHT CHANGES TEST: ALL PASS');
