import assert from 'node:assert/strict';
import { shouldParkBrowserForOverlays } from '../src/lib/browser-overlay-park.mjs';

const none = { palette: false, quickOpen: false, shortcuts: false, confirm: null, scheduleDraft: null, scheduleList: false, scheduleEdit: null };
assert.equal(shouldParkBrowserForOverlays(none), false);
assert.equal(shouldParkBrowserForOverlays({ ...none, palette: true }), true);
assert.equal(shouldParkBrowserForOverlays({ ...none, quickOpen: true }), true);
assert.equal(shouldParkBrowserForOverlays({ ...none, shortcuts: true }), true);
// Object-or-null states (confirm/schedule drafts) count by truthiness.
assert.equal(shouldParkBrowserForOverlays({ ...none, confirm: { title: 'x' } }), true);
assert.equal(shouldParkBrowserForOverlays({ ...none, scheduleDraft: { text: 'x' } }), true);
assert.equal(shouldParkBrowserForOverlays({ ...none, scheduleList: true }), true);
assert.equal(shouldParkBrowserForOverlays({ ...none, scheduleEdit: { id: 'x' } }), true);
assert.equal(shouldParkBrowserForOverlays(null), false);
assert.equal(shouldParkBrowserForOverlays(undefined), false);

console.log('Browser overlay park checks passed.');
