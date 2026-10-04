import assert from 'node:assert/strict';
import { duplicateSession } from '../src/lib/session-duplicate.mjs';

const NOW = new Date(2026, 9, 4, 6, 30, 0).getTime();
const src = {
  id: 's-abc',
  title: '원본',
  createdAt: NOW - 1000,
  messages: [
    { id: 'm-1', role: 'user', text: 'hi', ts: NOW - 900, done: true },
    { id: 'm-2', role: 'assistant', text: 'hello', ts: NOW - 800, done: true, usage: { inputTokens: 10, outputTokens: 5 } },
  ],
  cwd: 'C:/proj',
  engine: 'msp',
  mspSessionId: 'srv-1',
  pinned: true,
  archived: true,
};

// Clone gets a fresh id/title/createdAt, deep-cloned messages with fresh
// ids, keeps cwd/engine, and drops server-session and pin/archive state.
const copy = duplicateSession(src, { now: NOW });
assert.ok(copy);
assert.notEqual(copy.id, src.id);
assert.match(copy.id, /^s-/);
assert.equal(copy.title, '원본 복사본');
assert.equal(copy.createdAt, NOW);
assert.equal(copy.messages.length, 2);
assert.deepEqual(copy.messages.map((m) => m.text), ['hi', 'hello']);
assert.ok(copy.messages.every((m) => /^m-/.test(m.id)));
assert.ok(!copy.messages.some((m) => m.id === 'm-1' || m.id === 'm-2'));
assert.deepEqual(copy.messages[1].usage, { inputTokens: 10, outputTokens: 5 });
assert.equal(copy.cwd, 'C:/proj');
assert.equal(copy.engine, 'msp');
assert.equal(copy.mspSessionId, undefined);
assert.equal(copy.pinned, undefined);
assert.equal(copy.archived, undefined);

// Deep clone: mutating the copy leaves the source alone.
copy.messages[0].text = 'changed';
assert.equal(src.messages[0].text, 'hi');

// Invalid input yields null; corrupt message rows are dropped.
assert.equal(duplicateSession(null), null);
assert.equal(duplicateSession({}), null);
assert.equal(duplicateSession({ id: 'x' }), null);
assert.equal(duplicateSession({ id: 'x', messages: 'nope' }), null);
const dropped = duplicateSession({ id: 'x', title: 't', messages: [{ id: 'm-1', text: 'ok' }, null, 'junk'] }, { now: NOW });
assert.equal(dropped.messages.length, 1);
assert.equal(dropped.title, 't 복사본');
assert.equal(duplicateSession(src).createdAt <= Date.now(), true);

console.log('Session duplicate passed.');
