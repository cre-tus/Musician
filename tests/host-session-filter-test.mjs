import assert from 'node:assert/strict';
import {
  filterHostSessions,
  hideHostSessionId,
  hostSessionDateStrings,
  matchesHostSessionQuery,
  readHiddenHostSessionIds,
  visibleHostSessions,
} from '../src/lib/host-session-filter.mjs';

const store = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
  };
};

const h = (over = {}) => ({
  sessionId: 'sess-1',
  title: 'Musician 개선',
  name: 'codex-alpha',
  workspaceRoot: 'C:\\work\\Mudex',
  status: null,
  turnCount: 4,
  updatedAt: '2026-10-03T10:20:30.000Z',
  modelId: 'gpt-6.1',
  ...over,
});

// Hidden ids persist and filter the list.
const storage = store();
assert.deepEqual(readHiddenHostSessionIds(storage), []);
hideHostSessionId('sess-1', storage);
assert.deepEqual(readHiddenHostSessionIds(storage), ['sess-1']);
assert.deepEqual(visibleHostSessions([h(), h({ sessionId: 'sess-2' })], ['sess-1']).map((s) => s.sessionId), ['sess-2']);
assert.deepEqual(filterHostSessions([h()], '', ['sess-1']), []);
assert.deepEqual(filterHostSessions([h()], '', []).length, 1);

// Name / title / id / path search.
assert.equal(matchesHostSessionQuery(h(), '개선'), true);
assert.equal(matchesHostSessionQuery(h(), 'ALPHA'), true);
assert.equal(matchesHostSessionQuery(h(), 'sess-1'), true);
assert.equal(matchesHostSessionQuery(h(), 'Mudex'), true);
assert.equal(matchesHostSessionQuery(h(), 'gpt-6.1'), true);
assert.equal(matchesHostSessionQuery(h(), 'nope'), false);
assert.equal(matchesHostSessionQuery(h(), ''), true);

// Date search: ISO date and locale date both match.
const dates = hostSessionDateStrings(h());
assert.ok(dates.some((d) => d.includes('2026-10-03')), `iso date present: ${dates}`);
assert.equal(matchesHostSessionQuery(h(), '2026-10-03'), true);
assert.equal(matchesHostSessionQuery(h({ updatedAt: null }), '2026'), false);
console.log('Host session filter checks passed.');
