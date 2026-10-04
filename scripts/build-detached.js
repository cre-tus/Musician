'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'build', 'build-status.json');
const logFile = path.join(root, 'build', 'build.log');

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const current = readState();
if (current && current.state === 'running' && alive(current.pid)) {
  console.log(`Musician build is already running (PID ${current.pid}).`);
  console.log(`Status: npm run dist:status`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, [path.join(__dirname, 'build-worker.js')], {
  cwd: root,
  detached: true,
  windowsHide: true,
  stdio: ['ignore', log, log],
});
child.unref();
fs.closeSync(log);

fs.writeFileSync(stateFile, JSON.stringify({
  state: 'running',
  pid: child.pid,
  startedAt: new Date().toISOString(),
  logFile,
}, null, 2));

console.log(`Musician background build started (PID ${child.pid}).`);
console.log(`Status: npm run dist:status`);
console.log(`Log: ${logFile}`);
