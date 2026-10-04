'use strict';
// spawn-cli verification: .cmd/.bat wrapping (the mudex:verify-run EINVAL
// regression), quoting, passthrough, and handler wiring.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cliSpawnArgs, needsShell, quoteArg, spawnCli } = require('../electron/spawn-cli');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 1. needsShell: only .cmd/.bat on win32.
assert.equal(needsShell('npm.cmd', 'win32'), true);
assert.equal(needsShell('tool.BAT', 'win32'), true);
assert.equal(needsShell('npm.cmd', 'linux'), false);
assert.equal(needsShell('npm', 'win32'), false);
assert.equal(needsShell('git', 'win32'), false);
assert.equal(needsShell('', 'win32'), false);
console.log('ok - needsShell');

// 2. quoteArg: only quote when whitespace/quotes are present.
assert.equal(quoteArg('run'), 'run');
assert.equal(quoteArg('C:\\Program Files\\x'), '"C:\\Program Files\\x"');
assert.equal(quoteArg('a"b'), '"a\\"b"');
console.log('ok - quoteArg');

// 3. cliSpawnArgs: .cmd on win32 goes through cmd.exe /c; the /c line is
// wrapped in one outer pair of quotes for /s.
const plan = cliSpawnArgs('npm.cmd', ['run', 'typecheck', '--silent'], 'win32');
assert.equal(plan.file, 'cmd.exe');
assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
assert.equal(plan.args[3], '"npm.cmd run typecheck --silent"');
assert.equal(plan.shellWrap, true);
const planQ = cliSpawnArgs('C:\\Tools\\run thing.cmd', ['a b'], 'win32');
assert.equal(planQ.args[3], '""C:\\Tools\\run thing.cmd" "a b""');
console.log('ok - cliSpawnArgs wraps .cmd');

// 4. cliSpawnArgs: everything else passes through untouched.
const pass = cliSpawnArgs('npm', ['run', 'x'], 'win32');
assert.equal(pass.file, 'npm');
assert.deepEqual(pass.args, ['run', 'x']);
assert.equal(pass.shellWrap, false);
const nix = cliSpawnArgs('npm.cmd', ['--version'], 'linux');
assert.equal(nix.file, 'npm.cmd');
assert.equal(nix.shellWrap, false);
console.log('ok - cliSpawnArgs passthrough');

// 5. wiring: the mudex:verify-run handler must spawn through spawnCli, never
// bare spawn (bare spawn('npm.cmd') fails with EINVAL on Windows).
const main = read('electron/main.js');
const vStart = main.indexOf("ipcMain.handle('mudex:verify-run'");
const vEnd = main.indexOf("ipcMain.handle('mudex:revert-files'");
assert.ok(vStart > 0 && vEnd > vStart, 'verify-run handler found');
const handler = main.slice(vStart, vEnd);
assert.ok(handler.includes('spawnCli('), 'verify-run uses spawnCli');
assert.ok(!/[^a-zA-Z]spawn\(/.test(handler), 'verify-run has no bare spawn(');
assert.ok(main.includes("require('./spawn-cli')"), 'main uses the spawn-cli module');
console.log('ok - verify-run wiring');

// 6. integration: the wrapped path really executes (no EINVAL).
const child = spawnCli(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { windowsHide: true });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { out += d.toString(); });
child.on('error', (err) => {
  console.error('spawn error:', err);
  process.exitCode = 1;
});
child.on('close', (code) => {
  try {
    assert.equal(code, 0);
    assert.match(out.trim(), /\d+\.\d+\.\d+/);
    console.log('ok - spawnCli executes npm --version');
    console.log('SPAWN CLI TEST: ALL PASS');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
});
