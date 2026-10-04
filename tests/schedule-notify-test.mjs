import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scheduled-fire OS toast: a reservation firing while the user is away
// (or gaming) must surface like a completed run does.
// - main accepts a 'scheduled' status with its own body
// - the preload passes the status through untouched
// - App toasts on delivery, gated by the same background rules as runs
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('electron/main.js');
const preload = read('electron/preload.js');
const app = read('src/App.tsx');
const pkg = JSON.parse(read('package.json'));

// 1. main maps the scheduled status to its own body, keeps click-to-session.
const handlerAt = main.indexOf("ipcMain.handle('mudex:show-notification'");
assert.ok(handlerAt >= 0, 'notification handler exists');
const handler = main.slice(handlerAt, handlerAt + 1600);
assert.ok(handler.includes("'scheduled'"), 'scheduled status allowed');
assert.ok(handler.includes('예약된 프롬프트'), 'scheduled body text');
assert.ok(handler.includes('mudex:notification-click'), 'click still routes to the session');
console.log('ok - main status mapping');

// 2. preload passes (title, id, status) through to the handler.
assert.ok(
  /showNotification:\s*\(sessionTitle,\s*sessionId,\s*status\)\s*=>\s*ipcRenderer\.invoke\('mudex:show-notification',\s*\{\s*sessionTitle,\s*sessionId,\s*status\s*\}\)/.test(
    preload,
  ),
  'preload passes the status through',
);
console.log('ok - preload passthrough');

// 3. App toasts on delivery under the shared background rules.
assert.ok(app.includes("showNotification(") && app.includes("'scheduled'"), 'App toasts scheduled fires');
assert.ok(app.includes('shouldShowBackgroundNotification'), 'App reuses the background rules');
assert.ok(app.includes('backgroundNotifications'), 'App honors the notification setting');
console.log('ok - App delivery toast');

// 4. suite wiring.
assert.ok((pkg.scripts.test || '').includes('schedule-notify:test'), 'test chain includes schedule-notify');
assert.equal(pkg.scripts['schedule-notify:test'], 'node tests/schedule-notify-test.mjs');
console.log('ok - suite wiring');

console.log('SCHEDULE NOTIFY TEST: ALL PASS');
