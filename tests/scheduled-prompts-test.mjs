import assert from 'node:assert/strict';
import {
  MAX_SCHEDULED_PROMPTS,
  addScheduledPrompt,
  cancelScheduledPrompt,
  createScheduledPrompt,
  dueScheduledPrompts,
  fireableScheduledPrompt,
  formatRepeat,
  formatScheduledFireTime,
  markScheduledPrompt,
  nextRepeatFireTime,
  normalizeScheduledPrompts,
  readScheduledPrompts,
  rescheduleScheduledPrompt,
  rollRepeatingPrompt,
  staleScheduledPrompts,
  writeScheduledPrompts,
} from '../src/lib/scheduled-prompts.mjs';

const NOW = new Date(2026, 9, 4, 1, 5, 0).getTime();

function makeMemoryStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

// create: valid item gets id + pending status.
const created = createScheduledPrompt({ sessionId: 's1', text: '  아침 리포트  ', fireAt: NOW + 60000, now: NOW });
assert.ok(created && typeof created.id === 'string' && created.id.length > 0);
assert.equal(created.sessionId, 's1');
assert.equal(created.text, '아침 리포트');
assert.equal(created.fireAt, NOW + 60000);
assert.equal(created.status, 'pending');
assert.equal(created.createdAt, NOW);

// create: junk input is rejected, past fireAt is rejected.
assert.equal(createScheduledPrompt({ sessionId: '', text: 'hi', fireAt: NOW + 1, now: NOW }), null);
assert.equal(createScheduledPrompt({ sessionId: 's1', text: '   ', fireAt: NOW + 1, now: NOW }), null);
assert.equal(createScheduledPrompt({ sessionId: 's1', text: 'hi', fireAt: NOW - 1, now: NOW }), null);
assert.equal(createScheduledPrompt({ sessionId: 's1', text: 'hi', fireAt: 'soon', now: NOW }), null);
assert.equal(createScheduledPrompt(null), null);

// normalize: drops invalid rows, sorts by fireAt, caps at MAX.
const rows = [
  { id: 'b', sessionId: 's1', text: 'later', fireAt: NOW + 2000, createdAt: NOW, status: 'pending' },
  null,
  { id: 'a', sessionId: 's1', text: 'sooner', fireAt: NOW + 1000, createdAt: NOW, status: 'pending' },
  { id: 'x', sessionId: '', text: 'bad', fireAt: NOW + 500, createdAt: NOW, status: 'pending' },
  { id: 'y', sessionId: 's1', text: 'bad-status', fireAt: NOW + 500, createdAt: NOW, status: 'done' },
];
const normalized = normalizeScheduledPrompts(rows);
assert.deepEqual(normalized.map((item) => item.id), ['a', 'b']);
assert.deepEqual(normalizeScheduledPrompts('nope'), []);
const over = Array.from({ length: MAX_SCHEDULED_PROMPTS + 5 }, (_, i) => ({
  id: `id-${i}`, sessionId: 's1', text: `t${i}`, fireAt: NOW + i, createdAt: NOW, status: 'pending',
}));
assert.equal(normalizeScheduledPrompts(over).length, MAX_SCHEDULED_PROMPTS);

// add keeps sort order and refuses overflow / invalid.
const added = addScheduledPrompt(normalized, createScheduledPrompt({ sessionId: 's1', text: 'mid', fireAt: NOW + 1500, now: NOW }));
assert.deepEqual(added.map((item) => item.text), ['sooner', 'mid', 'later']);
assert.deepEqual(addScheduledPrompt(normalized, null), normalized);
assert.equal(addScheduledPrompt(over, created).length, MAX_SCHEDULED_PROMPTS);

// cancel removes by id only.
assert.deepEqual(cancelScheduledPrompt(added, 'missing').map((item) => item.text), ['sooner', 'mid', 'later']);
assert.deepEqual(cancelScheduledPrompt(added, added[0].id).map((item) => item.text), ['mid', 'later']);

// due: pending + fireAt <= now.
const mixed = normalizeScheduledPrompts([
  { id: 'due', sessionId: 's1', text: 'd', fireAt: NOW, createdAt: NOW, status: 'pending' },
  { id: 'future', sessionId: 's1', text: 'f', fireAt: NOW + 60000, createdAt: NOW, status: 'pending' },
  { id: 'fired', sessionId: 's1', text: 'x', fireAt: NOW - 1000, createdAt: NOW, status: 'fired' },
]);
assert.deepEqual(dueScheduledPrompts(mixed, NOW).map((item) => item.id), ['due']);

// mark flips status; unknown status/id leave the list alone.
assert.equal(markScheduledPrompt(mixed, 'due', 'fired').find((item) => item.id === 'due').status, 'fired');
assert.deepEqual(markScheduledPrompt(mixed, 'due', 'bogus'), mixed);
assert.deepEqual(markScheduledPrompt(mixed, 'missing', 'fired'), mixed);

// stale: pending items overdue by more than 24h are reported, not fired.
const old = NOW - 25 * 3600 * 1000;
const withOld = normalizeScheduledPrompts([
  { id: 'old', sessionId: 's1', text: 'o', fireAt: old, createdAt: old, status: 'pending' },
  { id: 'fresh', sessionId: 's1', text: 'n', fireAt: NOW - 1000, createdAt: NOW - 2000, status: 'pending' },
]);
assert.deepEqual(staleScheduledPrompts(withOld, NOW).map((item) => item.id), ['old']);

// format: relative for near times, clock/day for later ones.
assert.equal(formatScheduledFireTime(NOW + 10 * 60000, NOW), '10분 후');
assert.equal(formatScheduledFireTime(NOW + 2 * 3600 * 1000, NOW), '2시간 후');
assert.match(formatScheduledFireTime(NOW + 60000, NOW), /분 후/);
const tomorrow9 = new Date(2026, 9, 5, 9, 0, 0).getTime();
assert.match(formatScheduledFireTime(tomorrow9, NOW), /내일/);
const far = new Date(2026, 9, 9, 9, 0, 0).getTime();
assert.match(formatScheduledFireTime(far, NOW), /10-9|10\/9/);
assert.equal(formatScheduledFireTime(Number.NaN, NOW), '');

// repeat: create/normalize carry the cadence, defaulting to once.
const daily = createScheduledPrompt({ sessionId: 's1', text: 'daily', fireAt: NOW + 60000, repeat: 'daily', now: NOW });
assert.equal(daily.repeat, 'daily');
const weekly = createScheduledPrompt({ sessionId: 's1', text: 'weekly', fireAt: NOW + 60000, repeat: 'weekly', now: NOW });
assert.equal(weekly.repeat, 'weekly');
assert.equal(created.repeat, 'once');
assert.equal(
  createScheduledPrompt({ sessionId: 's1', text: 'bogus', fireAt: NOW + 60000, repeat: 'hourly', now: NOW }).repeat,
  'once',
);
const coerced = normalizeScheduledPrompts([
  { id: 'r1', sessionId: 's1', text: 'no-repeat', fireAt: NOW + 1000, createdAt: NOW, status: 'pending' },
  { id: 'r2', sessionId: 's1', text: 'bad-repeat', fireAt: NOW + 2000, createdAt: NOW, status: 'pending', repeat: 'minutely' },
]);
assert.deepEqual(coerced.map((item) => item.repeat), ['once', 'once']);

// nextRepeatFireTime steps forward by whole days/weeks past now.
assert.equal(nextRepeatFireTime(NOW, 'daily', NOW + 3600000), NOW + 86400000);
assert.equal(nextRepeatFireTime(NOW, 'weekly', NOW + 3600000), NOW + 7 * 86400000);
assert.equal(nextRepeatFireTime(NOW, 'daily', NOW + 3 * 86400000 + 1000), NOW + 4 * 86400000);
assert.equal(nextRepeatFireTime(NOW, 'once', NOW + 1000), null);
assert.equal(nextRepeatFireTime(NOW, 'bogus', NOW + 1000), null);
assert.equal(nextRepeatFireTime(Number.NaN, 'daily', NOW), null);

// rollRepeatingPrompt reschedules a repeating item, leaves the rest alone.
const repeating = normalizeScheduledPrompts([
  { id: 'rep', sessionId: 's1', text: 'r', fireAt: NOW, createdAt: NOW - 1000, status: 'pending', repeat: 'daily' },
  { id: 'one', sessionId: 's1', text: 'o', fireAt: NOW, createdAt: NOW - 1000, status: 'pending', repeat: 'once' },
]);
const rolled = rollRepeatingPrompt(repeating, 'rep', NOW + 1000);
assert.equal(rolled.find((item) => item.id === 'rep').fireAt, NOW + 86400000);
assert.equal(rolled.find((item) => item.id === 'rep').status, 'pending');
assert.equal(rolled.find((item) => item.id === 'one').fireAt, NOW);
assert.deepEqual(rollRepeatingPrompt(repeating, 'one', NOW + 1000), repeating);
assert.deepEqual(rollRepeatingPrompt(repeating, 'missing', NOW + 1000), repeating);

// Repeating items stay due (catch-up) even when stale; the app only
// retires one-shot items as missed.
const staleRep = normalizeScheduledPrompts([
  { id: 'old-rep', sessionId: 's1', text: 'r', fireAt: NOW - 25 * 3600000, createdAt: NOW - 26 * 3600000, status: 'pending', repeat: 'daily' },
]);
assert.deepEqual(dueScheduledPrompts(staleRep, NOW).map((item) => item.id), ['old-rep']);

// formatRepeat labels the cadence for the manage list.
assert.equal(formatRepeat('daily'), '매일');
assert.equal(formatRepeat('weekly'), '매주');
assert.equal(formatRepeat('once'), '');
assert.equal(formatRepeat('bogus'), '');

// storage round-trips through an injected store and never throws.
const storage = makeMemoryStorage();
assert.deepEqual(readScheduledPrompts(storage), []);
writeScheduledPrompts(mixed, storage);
assert.deepEqual(readScheduledPrompts(storage).map((item) => item.id), ['fired', 'due', 'future']);
assert.deepEqual(readScheduledPrompts(makeMemoryStorage({ 'mudex:scheduled-prompts:v1': '{broken' })), []);
writeScheduledPrompts(null, storage);
assert.deepEqual(readScheduledPrompts(), []);

// reschedule: pending items accept time/text/repeat patches; the list stays sorted.
const editBase = normalizeScheduledPrompts([
  { id: 'e1', sessionId: 's1', text: 'first', fireAt: NOW + 60000, createdAt: NOW, status: 'pending', repeat: 'once' },
  { id: 'e2', sessionId: 's1', text: 'second', fireAt: NOW + 120000, createdAt: NOW, status: 'pending', repeat: 'once' },
  { id: 'e3', sessionId: 's1', text: 'old', fireAt: NOW - 60000, createdAt: NOW - 120000, status: 'fired', repeat: 'once' },
]);
const edited = rescheduleScheduledPrompt(editBase, 'e1', { fireAt: NOW + 3600000, text: '  first-v2  ', repeat: 'daily' }, NOW);
const e1 = edited.find((item) => item.id === 'e1');
assert.equal(e1.fireAt, NOW + 3600000);
assert.equal(e1.text, 'first-v2');
assert.equal(e1.repeat, 'daily');
assert.equal(e1.status, 'pending');
assert.deepEqual(edited.map((item) => item.id), ['e3', 'e2', 'e1']);
assert.equal(edited.find((item) => item.id === 'e2').text, 'second');

// reschedule: unknown id, fired items, and invalid patches leave the list alone.
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'missing', { text: 'x' }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e3', { text: 'x' }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', { fireAt: NOW - 1 }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', { fireAt: 'soon' }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', { text: '   ' }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', { text: 'x'.repeat(8001) }, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', null, NOW), editBase);
assert.deepEqual(rescheduleScheduledPrompt(editBase, null, { text: 'x' }, NOW), editBase);
// Atomic: one bad field rejects the whole patch.
assert.deepEqual(rescheduleScheduledPrompt(editBase, 'e1', { text: 'ok', fireAt: NOW - 1 }, NOW), editBase);
// Repeat garbage coerces to once, matching create.
assert.equal(rescheduleScheduledPrompt(editBase, 'e2', { repeat: 'hourly' }, NOW).find((item) => item.id === 'e2').repeat, 'once');

// monthly: same wall-clock day next month, year rollover, month-end
// clamp (a clamped date stays clamped afterwards), multi-month catch-up.
const jan15 = new Date(2026, 0, 15, 9, 30, 0).getTime();
assert.equal(nextRepeatFireTime(jan15, 'monthly', jan15 + 1000), new Date(2026, 1, 15, 9, 30, 0).getTime());
const dec15 = new Date(2026, 11, 15, 9, 30, 0).getTime();
assert.equal(nextRepeatFireTime(dec15, 'monthly', dec15 + 1000), new Date(2027, 0, 15, 9, 30, 0).getTime());
const jan31 = new Date(2026, 0, 31, 9, 0, 0).getTime();
assert.equal(nextRepeatFireTime(jan31, 'monthly', jan31 + 1000), new Date(2026, 1, 28, 9, 0, 0).getTime());
const feb28 = new Date(2026, 1, 28, 9, 0, 0).getTime();
assert.equal(nextRepeatFireTime(feb28, 'monthly', feb28 + 1000), new Date(2026, 2, 28, 9, 0, 0).getTime());
assert.equal(nextRepeatFireTime(jan15, 'monthly', new Date(2026, 3, 1).getTime()), new Date(2026, 3, 15, 9, 30, 0).getTime());
// create/clean carry monthly; labels and rolls follow.
const monthly = createScheduledPrompt({ sessionId: 's1', text: 'm', fireAt: NOW + 60000, repeat: 'monthly', now: NOW });
assert.equal(monthly.repeat, 'monthly');
assert.equal(formatRepeat('monthly'), '매월');
const monRoll = normalizeScheduledPrompts([
  { id: 'mon', sessionId: 's1', text: 'm', fireAt: jan15, createdAt: jan15 - 1000, status: 'pending', repeat: 'monthly' },
]);
assert.equal(rollRepeatingPrompt(monRoll, 'mon', jan15 + 1000).find((item) => item.id === 'mon').fireAt, new Date(2026, 1, 15, 9, 30, 0).getTime());

// fireable: pending item + live session + no firing in flight, else null.
const fireSessions = [
  { id: 's1', archived: false },
  { id: 's2', archived: true },
];
const fireList = normalizeScheduledPrompts([
  { id: 'f1', sessionId: 's1', text: 'go', fireAt: NOW + 3600000, createdAt: NOW, status: 'pending', repeat: 'once' },
  { id: 'f2', sessionId: 's1', text: 'old', fireAt: NOW - 1000, createdAt: NOW - 2000, status: 'fired', repeat: 'once' },
  { id: 'f3', sessionId: 's2', text: 'arch', fireAt: NOW + 3600000, createdAt: NOW, status: 'pending', repeat: 'once' },
  { id: 'f4', sessionId: 'gone', text: 'orphan', fireAt: NOW + 3600000, createdAt: NOW, status: 'pending', repeat: 'once' },
]);
assert.equal(fireableScheduledPrompt(fireList, 'f1', fireSessions, null)?.id, 'f1');
assert.equal(fireableScheduledPrompt(fireList, 'missing', fireSessions, null), null);
assert.equal(fireableScheduledPrompt(fireList, 'f2', fireSessions, null), null);
assert.equal(fireableScheduledPrompt(fireList, 'f3', fireSessions, null), null);
assert.equal(fireableScheduledPrompt(fireList, 'f4', fireSessions, null), null);
assert.equal(fireableScheduledPrompt(fireList, 'f1', fireSessions, { id: 'f9' }), null);
assert.equal(fireableScheduledPrompt(fireList, 'f1', [], null), null);
assert.equal(fireableScheduledPrompt(null, 'f1', fireSessions, null), null);

console.log('Scheduled prompts passed.');
