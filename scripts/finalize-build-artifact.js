'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { showWindowsToast } = require('./windows-toast');
const { buildError } = require('./build-checks');

const LOCK_ERROR_CODES = ['EACCES', 'EPERM', 'EBUSY'];

function finalizePackagedArtifact(root, {
  stagingDirectory: stagingName = 'release-final',
  packagedName = 'Musician.exe',
  targetName = 'Musician.exe',
  versionedFallback = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const stagingDirectory = path.resolve(resolvedRoot, stagingName);
  const expectedStage = path.resolve(stagingDirectory, packagedName);
  if (!stagingDirectory.startsWith(`${resolvedRoot}${path.sep}`)
    || !fs.existsSync(expectedStage)) {
    throw new Error(`패키징된 ${packagedName} 파일을 찾을 수 없습니다.`);
  }

  const defaultTarget = path.resolve(resolvedRoot, targetName);
  let target = defaultTarget;
  try {
    fs.renameSync(expectedStage, target);
  } catch (error) {
    if (!LOCK_ERROR_CODES.includes(error.code)) throw error;
    if (!versionedFallback) {
      const locked = new Error(`기존 ${targetName}을(를) 교체할 수 없습니다. 실행 중인 앱을 닫은 뒤 npm run dist:install을 실행하세요.`);
      locked.code = 'INSTALL_LOCKED';
      throw locked;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    let sequence = 0;
    do {
      const suffix = sequence ? `-${sequence}` : '';
      target = path.resolve(resolvedRoot, `Musician-${stamp}${suffix}.exe`);
      sequence += 1;
    } while (fs.existsSync(target));
    fs.renameSync(expectedStage, target);
  }

  fs.rmSync(stagingDirectory, { recursive: true, force: true });
  return target;
}

function statArtifact(file, root) {
  try {
    const stat = fs.statSync(file);
    // State files are shared as build evidence: keep the path repo-relative
    // so no developer machine prefix leaks into them.
    return { path: root ? path.relative(path.resolve(root), file) : path.basename(file), bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const stateFile = path.join(root, 'build', 'build-status.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  // Never carry a previous failure's error/reason into a completed state.
  const { error: _prevError, reason: _prevReason, ...rest } = state;
  try {
    const artifactPath = finalizePackagedArtifact(root, {
      stagingDirectory: 'release-final',
      packagedName: 'Musician.exe',
      targetName: 'Musician.exe',
      versionedFallback: false,
    });
    const notificationSent = showWindowsToast('Musician 빌드 완료', `${path.basename(artifactPath)} 생성 완료.`);
    fs.writeFileSync(stateFile, JSON.stringify({
      ...rest,
      state: 'complete',
      reason: 'installed',
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      artifact: statArtifact(artifactPath, root),
      notificationSent,
    }, null, 2));
    console.log(`Build artifact finalized: ${artifactPath}`);
  } catch (error) {
    const message = String(error.message || error);
    if (error.code === 'INSTALL_LOCKED') {
      const staged = statArtifact(path.join(root, 'release-final', 'Musician.exe'), root);
      const notificationSent = showWindowsToast('Musician 빌드 대기', message);
      fs.writeFileSync(stateFile, JSON.stringify({
        ...state,
        state: 'install-pending',
        reason: 'install-locked',
        finishedAt: new Date().toISOString(),
        artifact: staged,
        error: buildError('INSTALL_LOCKED', message),
        notificationSent,
      }, null, 2));
    } else {
      const notificationSent = showWindowsToast('Musician 빌드 실패', message);
      fs.writeFileSync(stateFile, JSON.stringify({
        ...state,
        state: 'failed',
        reason: 'finalize-error',
        finishedAt: new Date().toISOString(),
        error: buildError(error.code || 'FINALIZE_ERROR', message),
        notificationSent,
      }, null, 2));
    }
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = { finalizePackagedArtifact };
