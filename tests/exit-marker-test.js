'use strict';
// Exit-marker verification: graceful quits vs kills/crashes become
// distinguishable in musician.log (recurring "spontaneous exit" sightings).
// - missing/corrupt/invalid marker reads as first-run, never throws
// - a stale `running` marker whose pid is dead reads as unclean
// - a stale `running` marker whose pid is alive reads as concurrent
// - a `clean` marker reads as clean
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkPreviousExit, markClean, markRunning } = require('../electron/exit-marker');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-exit-marker-test-'));
const dir = (name) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// 1. missing marker reads as first-run.
assert.deepEqual(checkPreviousExit(path.join(tmp, 'nope')).status, 'first-run');
console.log('ok - missing reads first-run');

// 2. corrupt / invalid markers read as first-run, never throw.
const bad = dir('bad');
fs.writeFileSync(path.join(bad, 'exit-marker.json'), '{oops');
assert.equal(checkPreviousExit(bad).status, 'first-run');
fs.writeFileSync(path.join(bad, 'exit-marker.json'), JSON.stringify({ state: 'bogus' }));
assert.equal(checkPreviousExit(bad).status, 'first-run');
fs.writeFileSync(path.join(bad, 'exit-marker.json'), JSON.stringify(['running']));
assert.equal(checkPreviousExit(bad).status, 'first-run');
console.log('ok - corrupt reads first-run');

// 3. clean quit round-trip reads as clean.
const clean = dir('clean');
assert.equal(markRunning(clean).ok, true);
assert.equal(markClean(clean).ok, true);
assert.equal(checkPreviousExit(clean).status, 'clean');
console.log('ok - clean round-trip');

// 4. stale running marker with a dead pid reads as unclean (with prior info).
const dead = dir('dead');
fs.writeFileSync(
  path.join(dead, 'exit-marker.json'),
  JSON.stringify({ state: 'running', pid: 2147483647, at: '2026-10-04T00:00:00.000Z' }),
);
const unclean = checkPreviousExit(dead);
assert.equal(unclean.status, 'unclean');
assert.equal(unclean.previous && unclean.previous.pid, 2147483647);
console.log('ok - dead pid reads unclean');

// 5. stale running marker with a live pid reads as concurrent (dev +
// packaged sharing one userData dir must not cry crash).
const live = dir('live');
assert.equal(markRunning(live).ok, true);
assert.equal(checkPreviousExit(live).status, 'concurrent');
console.log('ok - live pid reads concurrent');

// 6. writes are atomic (no tmp residue), missing dirs fail closed.
assert.equal(fs.readdirSync(clean).some((n) => n.includes('.tmp-')), false);
assert.equal(markRunning(path.join(tmp, 'nope', 'deeper')).ok, false);
assert.equal(markClean(path.join(tmp, 'nope', 'deeper')).ok, false);
console.log('ok - atomic writes');

// 7. wiring: main checks at boot, marks running, logs unclean exits,
// and marks clean on will-quit.
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
assert.ok(main.includes("require('./exit-marker')"), 'main uses the exit-marker module');
assert.ok(main.includes('checkPreviousExit'), 'main checks the previous exit');
assert.ok(main.includes('markRunning'), 'main marks running at boot');
assert.ok(main.includes('unclean-exit'), 'main logs unclean exits');
assert.ok(main.includes("app.on('will-quit'"), 'main marks clean on will-quit');
assert.ok(main.includes('markClean'), 'main marks clean');
console.log('ok - main wiring');

console.log('EXIT MARKER TEST: ALL PASS');
