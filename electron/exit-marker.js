'use strict';
// Graceful-quit diagnostics: the app marks itself `running` at boot and
// `clean` on will-quit, so a kill/crash (recurring "spontaneous exit"
// sightings) reads back as `unclean` instead of looking identical to a
// normal quit. A stale `running` marker whose pid is still alive reads as
// `concurrent` (dev + packaged sharing one userData dir). Never throws.
const fs = require('node:fs');
const path = require('node:path');

function markerFilePath(userDataDir) {
  return path.join(String(userDataDir), 'exit-marker.json');
}

function writeMarker(userDataDir, data) {
  const file = markerFilePath(userDataDir);
  const tmpFile = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data || {}));
    JSON.parse(fs.readFileSync(tmpFile, 'utf8')); // reread before replacing
    fs.renameSync(tmpFile, file);
    return { ok: true };
  } catch {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }
    return { ok: false };
  }
}

function readMarker(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerFilePath(userDataDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.state !== 'running' && parsed.state !== 'clean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function markRunning(userDataDir) {
  return writeMarker(userDataDir, { state: 'running', pid: process.pid, at: new Date().toISOString() });
}

function markClean(userDataDir) {
  return writeMarker(userDataDir, { state: 'clean', pid: process.pid, at: new Date().toISOString() });
}

// Reads the marker left by the previous run: first-run (none/corrupt),
// clean, unclean (stale running marker, pid dead), or concurrent (pid
// alive — a second instance sharing this userData dir).
function checkPreviousExit(userDataDir) {
  const previous = readMarker(userDataDir);
  if (!previous) return { status: 'first-run', previous: null };
  if (previous.state === 'clean') return { status: 'clean', previous };
  if (pidAlive(previous.pid)) return { status: 'concurrent', previous };
  return { status: 'unclean', previous };
}

module.exports = { checkPreviousExit, markClean, markRunning };
