import assert from 'node:assert/strict';
import { detachProjectSessions } from '../src/lib/project-sessions.mjs';

const sessions = [
  { id: 'a', cwd: 'C:\\work\\Proj', archived: false },
  { id: 'b', cwd: 'c:/work/proj', archived: false },
  { id: 'c', cwd: 'C:\\work\\Other', archived: false },
  { id: 'd', cwd: '', archived: false },
  { id: 'e', cwd: 'C:\\work\\Proj', archived: true },
];

// Removing a project detaches its sessions (case/separator-insensitive) so
// the sidebar group disappears; sessions themselves are preserved.
const next = detachProjectSessions(sessions, 'c:\\WORK\\proj/');
assert.deepEqual(next.map((s) => [s.id, s.cwd]), [
  ['a', ''],
  ['b', ''],
  ['c', 'C:\\work\\Other'],
  ['d', ''],
  ['e', 'C:\\work\\Proj'],
], 'visible sessions detached, others and archived untouched');
assert.equal(sessions[0].cwd, 'C:\\work\\Proj', 'input not mutated');
assert.deepEqual(detachProjectSessions(sessions, ''), sessions, 'empty folder is a no-op');
assert.deepEqual(detachProjectSessions([], 'C:\\work\\Proj'), [], 'empty sessions is a no-op');
assert.deepEqual(detachProjectSessions(sessions, 'C:\\nope'), sessions, 'unknown folder is a no-op');
console.log('Project session detach checks passed.');
