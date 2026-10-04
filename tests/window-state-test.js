'use strict';
// Window-state verification: load/save round-trip, on-screen validation
// (including negative-coordinate secondary monitors), restore fallback.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWindowState, saveWindowState, isOnScreen, restoreBounds } = require('../electron/window-state');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-window-state-test-'));

// Fake layout: primary 0..1920, secondary left at -1440..0 (portrait).
const DISPLAYS = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -1440, y: -680, width: 1440, height: 2512 },
];
const FALLBACK = { x: 100, y: 100, width: 1280, height: 860 };

// 1. missing file loads as null (caller uses defaults).
assert.equal(loadWindowState(path.join(tmp, 'nope')).data, null);
console.log('ok - missing loads null');

// 2. corrupt file loads as null, never throws.
fs.writeFileSync(path.join(tmp, 'renderer-state.json'), 'x');
fs.writeFileSync(path.join(tmp, 'window-state.json'), '{oops');
assert.equal(loadWindowState(tmp).data, null);
console.log('ok - corrupt loads null');

// 3. save/load round-trip, atomic (no tmp residue).
const saved = { x: -1440, y: -680, width: 1440, height: 2512, maximized: false };
assert.equal(saveWindowState(tmp, saved).ok, true);
assert.deepEqual(loadWindowState(tmp).data, saved);
assert.equal(fs.readdirSync(tmp).some((n) => n.includes('.tmp-')), false);
console.log('ok - round-trip atomic');

// 4. on-screen: primary, secondary (negative coords), straddling all pass;
// fully off-screen and degenerate sizes fail.
assert.equal(isOnScreen({ x: 100, y: 100, width: 800, height: 600 }, DISPLAYS), true);
assert.equal(isOnScreen({ x: -1440, y: -680, width: 1440, height: 2512 }, DISPLAYS), true);
assert.equal(isOnScreen({ x: -100, y: 100, width: 400, height: 300 }, DISPLAYS), true);
assert.equal(isOnScreen({ x: 5000, y: 100, width: 800, height: 600 }, DISPLAYS), false);
assert.equal(isOnScreen({ x: 100, y: 100, width: 10, height: 600 }, DISPLAYS), false, 'too narrow');
assert.equal(isOnScreen({ x: 100, y: 100, width: 800, height: 10 }, DISPLAYS), false, 'too short');
assert.equal(isOnScreen(null, DISPLAYS), false);
assert.equal(isOnScreen({ x: 100, y: 100, width: 800, height: 600 }, []), false);
console.log('ok - on-screen table');

// 5. restore: valid saved state wins, anything else falls back.
assert.deepEqual(restoreBounds(saved, DISPLAYS, FALLBACK), { bounds: saved, useSaved: true });
assert.deepEqual(restoreBounds(null, DISPLAYS, FALLBACK), { bounds: FALLBACK, useSaved: false });
assert.deepEqual(
  restoreBounds({ x: 5000, y: 0, width: 800, height: 600, maximized: false }, DISPLAYS, FALLBACK),
  { bounds: FALLBACK, useSaved: false },
  'off-screen (unplugged monitor) falls back',
);
assert.deepEqual(
  restoreBounds({ x: 0, y: 0, width: 800, height: 600, maximized: true }, DISPLAYS, FALLBACK).bounds.maximized,
  true,
  'maximized flag survives',
);
console.log('ok - restore fallback');

// 6. wiring: main creates the window from restored state and saves on move.
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
assert.ok(main.includes("require('./window-state')"), 'main uses the window-state module');
assert.ok(main.includes('restoreBounds'), 'main restores bounds');
assert.ok(main.includes('saveWindowState'), 'main saves bounds');
console.log('ok - main wiring');

console.log('WINDOW STATE TEST: ALL PASS');
