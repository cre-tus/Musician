import assert from 'node:assert/strict';
import { parseSidebarGroupState, toggleSidebarGroup } from '../src/lib/sidebar-group-state.mjs';

assert.deepEqual(parseSidebarGroupState('{"project-a":false,"project-b":true,"ignored":1}'), {
  'project-a': false,
  'project-b': true,
});
assert.deepEqual(parseSidebarGroupState('broken'), {});
assert.deepEqual(toggleSidebarGroup({}, 'project-a'), { 'project-a': false });
assert.deepEqual(toggleSidebarGroup({ 'project-a': false }, 'project-a'), { 'project-a': true });

console.log('Sidebar group state checks passed.');
