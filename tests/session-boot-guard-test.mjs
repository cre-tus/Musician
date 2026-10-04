import assert from 'node:assert/strict';
import { resolveBootSessions } from '../src/lib/session-boot-guard.mjs';

const boot = [
  { id: 'a', messages: [] },
  { id: 'b', messages: [] },
];
const loaded = [
  { id: 'x', messages: [] },
  { id: 'y', messages: [] },
];

// Untouched since boot: the file backup (crash recovery) applies.
assert.equal(resolveBootSessions(boot, boot, loaded), loaded, 'applies file sessions when untouched');

// Added a session while loading: user state wins, added session survives.
const added = [{ id: 'n', messages: [] }, ...boot];
assert.equal(resolveBootSessions(added, boot, loaded), added, 'keeps added session');

// Deleted a session while loading: stays deleted, no resurrection.
const deleted = [boot[0]];
assert.equal(resolveBootSessions(deleted, boot, loaded), deleted, 'keeps deletion');

// Edited (new array, same ids) while loading: message edits are not wiped.
const edited = boot.map((s) => ({ ...s }));
assert.equal(resolveBootSessions(edited, boot, loaded), edited, 'keeps message edits');

// Empty/corrupt file backup: never wipes current state.
assert.equal(resolveBootSessions(boot, boot, []), boot, 'empty file is a no-op');
assert.equal(resolveBootSessions(boot, boot, [{ id: 'z' }]), boot, 'corrupt entries are a no-op');
assert.equal(resolveBootSessions(boot, boot, null), boot, 'null file is a no-op');

console.log('Session boot guard checks passed.');
