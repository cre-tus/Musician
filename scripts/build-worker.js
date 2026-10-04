'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { showWindowsToast } = require('./windows-toast');
const { finalizePackagedArtifact } = require('./finalize-build-artifact');
const { buildError, finalTargetAllowed, installMatchesStaged, isFreshStaged } = require('./build-checks');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'build', 'build-status.json');
const stagedFile = path.join(root, 'release-final', 'Musician.exe');
const startedAt = new Date().toISOString();
const startedMs = Date.parse(startedAt);

function statArtifact(file) {
  try {
    const stat = fs.statSync(file);
    // State files are shared as build evidence: keep the path repo-relative
    // so no developer machine prefix leaks into them.
    return { path: path.relative(root, file), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function failState(reason, code, message) {
  const notificationSent = showWindowsToast('Musician 빌드 실패', message);
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ state: 'failed', reason, startedAt, finishedAt: new Date().toISOString(), error: buildError(code, message), notificationSent }, null, 2),
  );
  console.error(`${code}: ${message}`);
}

fs.writeFileSync(stateFile, JSON.stringify({ state: 'running', pid: process.pid, startedAt }, null, 2));

let child;
try {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dist:package']
    : ['run', 'dist:package'];
  child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
} catch (err) {
  failState('spawn-failed', 'SPAWN_FAILED', String(err.message || err));
  process.exit(1);
}

child.on('error', (err) => {
  failState('spawn-failed', 'SPAWN_FAILED', String(err.message || err));
  process.exit(1);
});

child.on('close', (code) => {
  if (code !== 0) {
    // Packaging itself failed. Never touch staging and never guess a file lock.
    failState('package-failed', 'PACKAGE_FAILED', `dist:package exited with code ${code} (see build/build.log).`);
    process.exit(code || 1);
    return;
  }
  // Packaging reported success: require a FRESH staged artifact so a leftover
  // from an earlier run is never mistaken for this build's output.
  const staged = statArtifact(stagedFile);
  if (!isFreshStaged(staged, startedMs)) {
    failState(
      'stale-artifact',
      'STALE_ARTIFACT',
      '패키징은 끝났지만 이번 빌드의 Musician.exe가 release-final에 없습니다. build/build.log를 확인하세요.',
    );
    process.exit(1);
    return;
  }
  const stagedInfo = { path: staged.path, bytes: staged.bytes, modifiedAt: staged.modifiedAt };
  try {
    const file = finalizePackagedArtifact(root, {
      stagingDirectory: 'release-final',
      packagedName: 'Musician.exe',
      targetName: 'Musician.exe',
      versionedFallback: false,
    });
    if (!finalTargetAllowed(file)) {
      const bad = new Error(`최종 산출물은 Musician.exe여야 합니다: ${path.basename(file)}`);
      bad.code = 'BAD_FINAL_TARGET';
      throw bad;
    }
    const installed = statArtifact(file);
    if (!installMatchesStaged(stagedInfo, installed)) {
      const mismatch = new Error('설치된 파일이 스테이징된 빌드와 다릅니다. build/build.log를 확인하세요.');
      mismatch.code = 'INSTALL_MISMATCH';
      throw mismatch;
    }
    const notificationSent = showWindowsToast('Musician 빌드 완료', `${path.basename(file)} 생성 완료.`);
    fs.writeFileSync(stateFile, JSON.stringify({
      state: 'complete',
      reason: 'installed',
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      artifact: installed && { path: installed.path, bytes: installed.bytes, modifiedAt: installed.modifiedAt },
      notificationSent,
    }, null, 2));
    process.exit(0);
  } catch (err) {
    const message = String(err.message || err);
    const code = String(err.code || 'FINALIZE_ERROR');
    console.error(`${code}: ${message}`);
    if (err.code === 'INSTALL_LOCKED') {
      // Packaged fine, root replace blocked by a running app. Staging is kept
      // for `npm run dist:install` after the app is closed.
      const notificationSent = showWindowsToast('Musician 빌드 대기', message);
      fs.writeFileSync(stateFile, JSON.stringify({
        state: 'install-pending',
        reason: 'install-locked',
        startedAt,
        finishedAt: new Date().toISOString(),
        artifact: stagedInfo,
        error: buildError('INSTALL_LOCKED', message),
        notificationSent,
      }, null, 2));
    } else {
      const notificationSent = showWindowsToast('Musician 빌드 실패', message);
      fs.writeFileSync(stateFile, JSON.stringify({
        state: 'failed',
        reason: 'finalize-error',
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 1,
        artifact: stagedInfo,
        error: buildError(code, message),
        notificationSent,
      }, null, 2));
    }
    process.exit(1);
  }
});
