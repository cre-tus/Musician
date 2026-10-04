'use strict';

// Git IPC safety contract: option-injection and credential-leak guards.
// - git-safety.mjs rules are pure and unit-tested here.
// - main registers the guards in the show/clone/branch handlers.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isSafeCloneSource, isSafeRepoRelativePath, redactRemoteUrl } = require('../electron/git-safety');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('electron/main.js');
const pkg = JSON.parse(read('package.json'));

// 1. Repo-relative path guard (git-show, mirrors revert-files).
assert.equal(isSafeRepoRelativePath('src/App.tsx'), true);
assert.equal(isSafeRepoRelativePath('a/b/c.txt'), true);
assert.equal(isSafeRepoRelativePath('../outside.txt'), false);
assert.equal(isSafeRepoRelativePath('a/../../outside.txt'), false);
assert.equal(isSafeRepoRelativePath('..\\win.txt'), false);
assert.equal(isSafeRepoRelativePath('C:\\abs\\x.txt'), false);
assert.equal(isSafeRepoRelativePath('/abs/x.txt'), false);
assert.equal(isSafeRepoRelativePath(''), false);
assert.equal(isSafeRepoRelativePath(null), false);
assert.equal(isSafeRepoRelativePath('a\0b'), false);
console.log('ok - repo-relative path guard');

// 2. Clone source guard (leading '-' would parse as a git clone option).
assert.equal(isSafeCloneSource('https://github.com/acme/app.git'), true);
assert.equal(isSafeCloneSource('git@github.com:acme/app.git'), true);
assert.equal(isSafeCloneSource('C:\\repos\\app'), true);
assert.equal(isSafeCloneSource('--upload-pack=calc.exe'), false);
assert.equal(isSafeCloneSource('-u'), false);
assert.equal(isSafeCloneSource(''), false);
assert.equal(isSafeCloneSource('x'.repeat(2001)), false);
console.log('ok - clone source guard');

// 3. Remote URL redaction (branch tooltip must never show tokens).
assert.equal(redactRemoteUrl('https://user:token123@github.com/acme/app.git'), 'https://github.com/acme/app.git');
assert.equal(redactRemoteUrl('https://github.com/acme/app.git'), 'https://github.com/acme/app.git');
assert.equal(redactRemoteUrl('git@github.com:acme/app.git'), 'git@github.com:acme/app.git');
assert.equal(redactRemoteUrl(''), '');
assert.ok(!redactRemoteUrl('https://user:p%40ss@host/x.git').includes('p%40ss'), 'encoded password stripped');
console.log('ok - remote redaction');

// 4. Main wiring.
assert.ok(main.includes("require('./git-safety')"), 'main requires git-safety');
assert.ok(main.includes('isSafeRepoRelativePath(file)'), 'git-show validates the path');
assert.ok(main.includes('isSafeCloneSource(source)'), 'git-clone validates the source');
assert.ok(main.includes('redactRemoteUrl(remote.stdout)'), 'git-branch redacts the remote');
console.log('ok - main wiring');

// 5. Suite wiring.
assert.ok((pkg.scripts.test || '').includes('git-safety:test'), 'test chain includes git-safety');
assert.equal(pkg.scripts['git-safety:test'], 'node tests/git-safety-test.js');
console.log('ok - suite wiring');

console.log('GIT SAFETY TEST: ALL PASS');
