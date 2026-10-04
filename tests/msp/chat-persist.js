'use strict';
// Chat persistence + work-summary + autoscroll test:
// assistant messages must survive restart (sanitized save, append-first,
// file backup), carry a durable work summary, and pull the scrollbar down.
// Exit 0 = ALL PASS, exit 1 = FAIL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Extracts one brace-matched top-level function verbatim (see right-changes.js).
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

// Bodies are plain JS-compatible TS; only signatures need normalizing.
// One combined module so saveSessions sees its helpers, bound to a store.
function makeLib(store) {
  const tsSrc = read('src/lib/mudex.ts');
  const parts = [];
  const lsMatch = tsSrc.match(/const LS_SESSIONS = ('[^']+');/);
  assert.ok(lsMatch, 'LS_SESSIONS defined');
  parts.push(`const LS_SESSIONS = ${lsMatch[1]};`);
  for (const n of ['SAVE_TEXT_CAP', 'SAVE_TAIL_CAP']) {
    const m = tsSrc.match(new RegExp(`const ${n} = (\\d+);`));
    assert.ok(m, `${n} defined`);
    parts.push(`const ${n} = ${m[1]};`);
  }
  const norm = (src) =>
    src
      .replace('function safeStringify(v: unknown): string | null {', 'function safeStringify(v) {')
      .replace('function trimMessageForSave(m: ChatMessage): ChatMessage {', 'function trimMessageForSave(m) {')
      .replace(
        'const cut = (t: string | undefined, cap: number): string | undefined => {',
        'const cut = (t, cap) => {',
      )
      .replace('function saveSessions(sessions: Session[]): boolean {', 'function saveSessions(sessions) {')
      .replace('const out: ChatMessage =', 'const out =');
  for (const name of ['safeStringify', 'trimMessageForSave', 'saveSessions']) {
    const at = tsSrc.indexOf(`export function ${name}(`);
    assert.ok(at >= 0, `${name} defined in lib/mudex`);
    parts.push(norm(extractFn(tsSrc, at)));
  }
  return new Function('localStorage', `${parts.join('\n')}\nreturn { safeStringify, trimMessageForSave, saveSessions };`)(
    store,
  );
}

const memStore = () => {
  let v = null;
  return { setItem: (k, x) => { v = { k, v: x }; }, getItem: () => (v ? v.v : null) };
};
const { safeStringify, trimMessageForSave } = makeLib(memStore());

// 1. safeStringify never throws on hostile values.
assert.equal(JSON.parse(safeStringify({ a: 10n })).a, 10, 'BigInt becomes a number');
const circ = { x: 1 };
circ.self = circ;
assert.equal(JSON.parse(safeStringify(circ)).self, '[ Circular ]', 'circular refs contained');
assert.equal(JSON.parse(safeStringify({ f: () => {}, s: Symbol('x'), n: 1 })).n, 1, 'functions/symbols dropped');
console.log('ok - safeStringify contains hostile values');

// 2. saveSessions survives a quota-throwing store via the trimmed fallback.
// Budget sits between the trimmed size (~cap) and the full size so only the
// fallback fits — mirroring a real quota squeeze.
const big = 'x'.repeat(60000);
let stored = null;
const quotaStore = {
  setItem: (k, v) => {
    if (v.length > 55000) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    stored = { k, v };
  },
  getItem: () => null,
};
const saveSessions = makeLib(quotaStore).saveSessions;
const ok = saveSessions([{ id: 's1', title: 't', createdAt: 1, messages: [{ id: 'm', role: 'assistant', text: big, ts: 1, done: true }] }]);
assert.equal(ok, true, 'save reports success through fallback');
const roundtrip = JSON.parse(stored.v);
assert.equal(roundtrip[0].messages.length, 1, 'assistant message preserved, not dropped');
assert.ok(roundtrip[0].messages[0].text.length < big.length, 'oversized text trimmed instead of losing everything');
assert.ok(roundtrip[0].messages[0].text.includes('생략'), 'trim marker present');
console.log('ok - quota fallback trims instead of losing the message');

// 3. trim keeps small messages byte-identical.
const small = { id: 'm', role: 'user', text: 'hi', ts: 1, done: true };
assert.deepEqual(trimMessageForSave(small), small, 'small messages untouched');
console.log('ok - trim is a no-op for small messages');

// 4. wiring: done handler appends first, enriches later, scrolls down.
const chat = read('src/components/ChatView.tsx');
const doneRegion = chat.slice(chat.indexOf('const offDone'), chat.indexOf('const offItem'));
assert.ok(doneRegion.length > 500, 'done handler region found');
assert.ok(
  doneRegion.indexOf('onAppendAssistant({') < doneRegion.indexOf('await gitSnapshot'),
  'assistant message appended before slow git enrichment',
);
assert.ok(doneRegion.includes('onUpdateMessage'), 'changed files patched in after enrichment');
assert.ok(doneRegion.includes('followScrollRef.current = true'), 'scroll follows on new assistant message');
assert.ok(/scrollTop = \w+\.scrollHeight/.test(doneRegion), 'scrollbar pulled to bottom');
console.log('ok - append-first + enrich-later + autoscroll wiring');

// 5. wiring: durable work summary on the message + file backup store.
const types = read('src/types.ts');
assert.ok(/work\?: string\[\]/.test(types), 'ChatMessage carries work summary');
assert.ok(chat.includes('작업 내역'), 'work summary rendered');
const main = read('electron/main.js');
assert.ok(main.includes('mudex:sessions-save'), 'main persists sessions file');
assert.ok(main.includes('mudex:sessions-load'), 'main loads sessions file');
const preload = read('electron/preload.js');
assert.ok(preload.includes('sessionsSave') && preload.includes('sessionsLoad'), 'preload exposes session file store');
const appView = read('src/App.tsx');
assert.ok(appView.includes('sessionsSave') && appView.includes('sessionsLoad'), 'App uses the file backup');
console.log('ok - work summary + file backup wiring');

console.log('CHAT PERSIST TEST: ALL PASS');
