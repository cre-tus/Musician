'use strict';
// Build pipeline verification: toast escaping, build-state helpers,
// finalize behavior on temp dirs, and worker wiring (source assertions —
// build-worker executes on require, so never load it).
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { xmlEscape } = require('../../scripts/windows-toast');
const {
  isFreshStaged,
  installMatchesStaged,
  finalTargetAllowed,
  buildError,
  formatStateError,
} = require('../../scripts/build-checks');
const { finalizePackagedArtifact } = require('../../scripts/finalize-build-artifact');
const { isStaleRootExe, isStaleUnpackDir, planClean, musicianRunning } = require('../../scripts/dist-clean');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-build-test-'));

// 1. xml escaping covers the five predefined entities.
assert.equal(xmlEscape('<a href="x&y">o\'k</a>'), '&lt;a href=&quot;x&amp;y&quot;&gt;o&apos;k&lt;/a&gt;');
assert.equal(xmlEscape(123), '123');
console.log('ok - xmlEscape');

// 2. staged freshness: only this run's artifact counts.
assert.equal(isFreshStaged({ mtimeMs: 2000 }, 1000), true);
assert.equal(isFreshStaged({ mtimeMs: 999 }, 1000), false);
assert.equal(isFreshStaged(null, 1000), false);
console.log('ok - staged freshness');

// 3. installed artifact must equal the staged bytes.
assert.equal(installMatchesStaged({ bytes: 10 }, { bytes: 10 }), true);
assert.equal(installMatchesStaged({ bytes: 10 }, { bytes: 11 }), false);
assert.equal(installMatchesStaged({ bytes: 10 }, null), false);
console.log('ok - install matches staged');

// 4. the final result is always the plain Musician.exe (no next/dated names).
assert.equal(finalTargetAllowed(path.join(tmp, 'Musician.exe')), true);
assert.equal(finalTargetAllowed(path.join(tmp, 'Musician-next.exe')), false);
assert.equal(finalTargetAllowed(path.join(tmp, 'Musician-20260101T000000Z.exe')), false);
console.log('ok - final target policy');

// 5. structured errors, with legacy string rendering.
assert.deepEqual(buildError('STALE_ARTIFACT', 'msg'), { code: 'STALE_ARTIFACT', message: 'msg' });
assert.equal(formatStateError({ code: 'INSTALL_LOCKED', message: 'm' }), 'INSTALL_LOCKED: m');
assert.equal(formatStateError('legacy string'), 'legacy string');
assert.equal(formatStateError(null), '');
console.log('ok - structured errors');

// 6. finalize success moves staging to root and cleans up.
const r1 = path.join(tmp, 'r1');
fs.mkdirSync(path.join(r1, 'release-final'), { recursive: true });
fs.writeFileSync(path.join(r1, 'release-final', 'Musician.exe'), 'STAGED-BYTES');
const out1 = finalizePackagedArtifact(r1, {
  stagingDirectory: 'release-final',
  packagedName: 'Musician.exe',
  targetName: 'Musician.exe',
  versionedFallback: false,
});
assert.equal(out1, path.join(r1, 'Musician.exe'));
assert.equal(fs.readFileSync(out1, 'utf8'), 'STAGED-BYTES');
assert.equal(fs.existsSync(path.join(r1, 'release-final')), false, 'staging removed');
console.log('ok - finalize success');

// 7. defaults follow the plain Musician.exe policy (no next/dated fallback).
const r2 = path.join(tmp, 'r2');
fs.mkdirSync(path.join(r2, 'release-final'), { recursive: true });
fs.writeFileSync(path.join(r2, 'release-final', 'Musician.exe'), 'X');
const out2 = finalizePackagedArtifact(r2);
assert.equal(out2, path.join(r2, 'Musician.exe'));
console.log('ok - finalize defaults');

// 8. missing staging and path traversal are hard errors, never a guess.
assert.throws(() => finalizePackagedArtifact(path.join(tmp, 'r3'), {}), /찾을 수 없습니다/);
const r4 = path.join(tmp, 'r4');
fs.mkdirSync(path.join(r4, 'release-final'), { recursive: true });
fs.writeFileSync(path.join(r4, 'release-final', 'Musician.exe'), 'X');
assert.throws(() => finalizePackagedArtifact(r4, { stagingDirectory: '../outside' }), /찾을 수 없습니다/);
console.log('ok - finalize rejects missing/traversal');

// 9. locked target without fallback keeps staging and reports INSTALL_LOCKED;
// with fallback a versioned file is produced instead.
const r5 = path.join(tmp, 'r5');
fs.mkdirSync(path.join(r5, 'release-final'), { recursive: true });
fs.writeFileSync(path.join(r5, 'release-final', 'Musician.exe'), 'X');
fs.mkdirSync(path.join(r5, 'Musician.exe')); // rename onto a dir fails like a lock
assert.throws(
  () => finalizePackagedArtifact(r5, { stagingDirectory: 'release-final', packagedName: 'Musician.exe', targetName: 'Musician.exe', versionedFallback: false }),
  (e) => e.code === 'INSTALL_LOCKED',
);
assert.equal(fs.existsSync(path.join(r5, 'release-final', 'Musician.exe')), true, 'staging kept for dist:install');
const out5 = finalizePackagedArtifact(r5, { stagingDirectory: 'release-final', packagedName: 'Musician.exe', targetName: 'Musician.exe', versionedFallback: true });
assert.match(path.basename(out5), /^Musician-\d{8}T\d{6}Z(-\d+)?\.exe$/);
console.log('ok - locked target paths');

// 10. worker: no automatic process kill (explicit user policy), structured
// state writes, fresh-staged guard before finalize.
const worker = read('scripts/build-worker.js');
assert.ok(!worker.includes('taskkill'), 'no automatic taskkill');
assert.ok(!worker.includes('killExe'), 'no kill helper');
assert.ok(worker.includes('isFreshStaged'), 'freshness guard before finalize');
assert.ok(worker.includes('installMatchesStaged'), 'installed bytes must match staged');
assert.ok(worker.includes('finalTargetAllowed'), 'final name policy enforced');
assert.ok(worker.includes('STALE_ARTIFACT'), 'stale artifact code');
assert.ok(worker.includes('INSTALL_LOCKED'), 'install locked code');
assert.ok(worker.includes('install-pending'), 'lock waits for dist:install, not a kill');
assert.ok(worker.includes('build-status.json'), 'state file updated');
console.log('ok - worker wiring');

// 11. detached launcher guards concurrent builds.
const detached = read('scripts/build-detached.js');
assert.ok(detached.includes('already running'), 'concurrent build guard');
assert.ok(detached.includes('build-worker.js'), 'spawns the worker');
assert.ok(detached.includes('build.log'), 'log file');
console.log('ok - detached launcher');

// 12. dist:clean selects only known build residue, never the live exe.
assert.equal(isStaleRootExe('Musician.exe'), false);
assert.equal(isStaleRootExe('Musician-next.exe'), true);
assert.equal(isStaleRootExe('Musician-20260101T000000Z.exe'), true);
assert.equal(isStaleRootExe('Musician-20260101T000000Z-2.exe'), true);
assert.equal(isStaleRootExe('SomethingElse.exe'), false);
assert.equal(isStaleRootExe('Musician.exe.bak'), false);
console.log('ok - stale exe selection');

const fakeExists = (files) => (p) => files.has(String(p));
const unpackFiles = (dir) => new Set([
  path.join(dir, 'Musician.exe'),
  path.join(dir, 'resources', 'app.asar'),
]);
assert.equal(isStaleUnpackDir(path.join(tmp, 'u1'), fakeExists(unpackFiles(path.join(tmp, 'u1')))), true);
assert.equal(isStaleUnpackDir(path.join(tmp, 'u2'), fakeExists(new Set([path.join(tmp, 'u2', 'Musician.exe')]))), false, 'asar required');
assert.equal(isStaleUnpackDir(path.join(tmp, 'u3'), fakeExists(new Set([path.join(tmp, 'u3', 'something.txt')]))), false, 'random temp dirs never match');
assert.equal(isStaleUnpackDir(tmp, fakeExists(unpackFiles(tmp))), true, 'nested depth does not matter');
console.log('ok - stale unpack selection');

// 13. planClean combines both with injected fs; the live exe is never listed.
const fakeRoot = path.join(tmp, 'plan-root');
const fakeTemp = path.join(tmp, 'plan-temp');
const planFiles = new Set([
  path.join(fakeRoot, 'Musician.exe'),
  path.join(fakeRoot, 'Musician-next.exe'),
  ...unpackFiles(path.join(fakeTemp, 'aaa')),
  path.join(fakeTemp, 'bbb', 'notes.txt'),
]);
const plan = planClean({
  root: fakeRoot,
  tempDir: fakeTemp,
  readdir: (d) => (d === fakeRoot
    ? ['Musician.exe', 'Musician-next.exe']
    : ['aaa', 'bbb']),
  exists: fakeExists(planFiles),
});
assert.deepEqual(plan.exes, [path.join(fakeRoot, 'Musician-next.exe')]);
assert.deepEqual(plan.unpackDirs, [path.join(fakeTemp, 'aaa')]);
console.log('ok - clean plan');

// 14. the running-process guard refuses while the app is up.
assert.equal(musicianRunning(() => 'Musician.exe                   12345 Console'), true);
assert.equal(musicianRunning(() => 'INFO: No tasks are running'), false);
assert.equal(musicianRunning(() => { throw new Error('no tasklist'); }), true, 'unknown means refuse');
console.log('ok - running guard');

console.log('BUILD SCRIPT TEST: ALL PASS');
