'use strict';
// Windows-safe child_process spawning. .cmd/.bat files cannot be spawned
// directly (libuv returns EINVAL) — they must run through cmd.exe /c.
// Pure helpers (needsShell/quoteArg/cliSpawnArgs) are unit-tested in
// spawn-cli-test.js; spawnCli is the thin runtime wrapper.
const { spawn } = require('node:child_process');

function needsShell(file, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(file || ''));
}

function quoteArg(a) {
  const s = String(a);
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

// Pure plan: which binary/args/flags to spawn. On win32, .cmd/.bat go
// through cmd.exe with windowsVerbatimArguments so libuv does not re-quote
// the /c line (cmd.exe parses it itself; /s strips the outer quotes).
function cliSpawnArgs(file, args, platform = process.platform) {
  const list = Array.isArray(args) ? args : [];
  if (needsShell(file, platform)) {
    const line = [file, ...list].map(quoteArg).join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], shellWrap: true };
  }
  return { file, args: list, shellWrap: false };
}

function spawnCli(file, args, opts) {
  const plan = cliSpawnArgs(file, args);
  return spawn(plan.file, plan.args, plan.shellWrap ? { ...opts, windowsVerbatimArguments: true } : opts);
}

module.exports = { cliSpawnArgs, needsShell, quoteArg, spawnCli };
