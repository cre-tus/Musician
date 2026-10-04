import assert from 'node:assert/strict';
import { runNotificationStatus, shouldShowBackgroundNotification } from '../src/lib/notification-rules.mjs';

const background = { enabled: true, isActiveSession: false, windowFocused: true, willContinueAutomatically: false };
assert.equal(shouldShowBackgroundNotification(background), true);
assert.equal(shouldShowBackgroundNotification({ ...background, enabled: false }), false);
assert.equal(shouldShowBackgroundNotification({ ...background, isActiveSession: true, windowFocused: true }), false);
assert.equal(shouldShowBackgroundNotification({ ...background, isActiveSession: true, windowFocused: false }), true);
assert.equal(shouldShowBackgroundNotification({ ...background, willContinueAutomatically: true }), false);
assert.equal(runNotificationStatus({ cancelled: false, completedSuccessfully: true }), 'success');
assert.equal(runNotificationStatus({ cancelled: false, completedSuccessfully: false }), 'failed');
assert.equal(runNotificationStatus({ cancelled: true, completedSuccessfully: false }), 'stopped');

console.log('Background notification checks passed.');
