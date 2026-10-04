import assert from 'node:assert/strict';
import { matchesSidebarSessionQuery, parseSidebarSessionQuery } from '../src/lib/sidebar-session-query.mjs';

assert.deepEqual(parseSidebarSessionQuery('fix sidebar in:"C:/My Work" is:failed has:draft'), {
  text: 'fix sidebar',
  filters: [{ type: 'in', value: 'c:/my work' }, { type: 'is', value: 'failed' }, { type: 'has', value: 'draft' }],
});
assert.deepEqual(parseSidebarSessionQuery('fix sidebar in:'), { text: 'fix sidebar', filters: [] }, 'an incomplete path operator should not hide every session while the user types');
assert.deepEqual(parseSidebarSessionQuery('is:unknown has:queued "two words"'), {
  text: 'is:unknown two words',
  filters: [{ type: 'has', value: 'queued' }],
});
const candidate = { id: 'session-1', cwd: 'C:\\My Work\\App', pinned: true };
const state = { runningIds: ['session-1'], failedIds: [], draftIds: ['session-1'], queuedIds: [] };
assert.equal(matchesSidebarSessionQuery(candidate, [{ type: 'in', value: 'my work' }, { type: 'is', value: 'pinned' }, { type: 'is', value: 'running' }, { type: 'has', value: 'draft' }], state), true);
assert.equal(matchesSidebarSessionQuery(candidate, [{ type: 'is', value: 'failed' }], state), false);
assert.equal(matchesSidebarSessionQuery(candidate, [{ type: 'has', value: 'queued' }], state), false);
assert.equal(matchesSidebarSessionQuery({ ...candidate, archived: true }, [{ type: 'is', value: 'archived' }]), true);
console.log('Sidebar session query operator checks passed.');
