import assert from 'node:assert/strict';
import { matchScore, parsePaletteQuery, scopePaletteItems } from '../src/lib/palette-query.mjs';

assert.deepEqual(parsePaletteQuery('  #  build  '), { scope: 'sessions', query: 'build' });
assert.deepEqual(parsePaletteQuery('> save'), { scope: 'commands', query: 'save' });
assert.deepEqual(parsePaletteQuery('@ src/App'), { scope: 'tabs', query: 'src/App' });
assert.deepEqual(parsePaletteQuery('open file'), { scope: 'all', query: 'open file' });
assert.deepEqual(parsePaletteQuery(''), { scope: 'all', query: '' });

const threads = [{ id: 'session-1' }];
const actions = [{ id: 'switch-tab-1' }, { id: 'save-file' }];
assert.deepEqual(scopePaletteItems('commands', threads, actions), { threads: [], actions });
assert.deepEqual(scopePaletteItems('sessions', threads, actions), { threads, actions: [] });
assert.deepEqual(scopePaletteItems('tabs', threads, actions), { threads: [], actions: [actions[0]] });
assert.deepEqual(scopePaletteItems('all', threads, actions), { threads, actions });

// Scoring tiers: exact > prefix > substring > fuzzy-subsequence > no match.
assert.equal(matchScore('', ['anything']), 0);
assert.ok(matchScore('save', ['save']) > matchScore('save', ['save-file']));
assert.ok(matchScore('save', ['save-file']) > matchScore('save', ['my-save-file']));
assert.ok(matchScore('save', ['my-save-file']) > matchScore('save', ['squash vague']));
assert.equal(matchScore('save', ['print']), -1);
assert.equal(matchScore('alpha beta', ['alpha only']), -1);

// Regression (duplicate-session incident): for '새 스레드' the new-thread
// action must not lose to per-session actions. A startsWith keyword
// ('스레드 복제') outscores a mid-title substring — hence App.tsx carries
// no such keyword on the duplicate action (tie falls back to action order,
// where 'new' sorts first).
const newThread = ['새 스레드', 'new', 'Ctrl+N', 'new chat', 'new thread'];
const dupFixed = ['세션 복제 · 새 스레드', 'duplicate-session-s-1', '대화 없음', 'duplicate session', 'clone session', 'copy session', '세션 복제', '복제', '사본', '새 스레드', ''];
const dupOld = [...dupFixed.slice(0, 7), '스레드 복제', ...dupFixed.slice(7)];
assert.ok(matchScore('새 스레드', dupOld) > matchScore('새 스레드', newThread));
assert.ok(matchScore('새 스레드', dupFixed) <= matchScore('새 스레드', newThread));
assert.ok(matchScore('복제', dupFixed) >= 1000);
console.log('Palette query scopes passed.');
