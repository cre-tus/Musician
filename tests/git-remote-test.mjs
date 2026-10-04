import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Git remote-sync contract: branch display + pull/push/clone.
// - git-status.mjs parses upstream ahead/behind counts (pure, unit-tested).
// - main registers branch/pull/push/clone IPC; preload + types expose them.
// - FilesTab changed-section carries the branch badge, pull/push buttons and
//   the clone dialog; styles exist for the new chrome.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { parseUpstreamCounts } = await import('../src/lib/git-status.mjs');
const main = read('electron/main.js');
const preload = read('electron/preload.js');
const types = read('src/types.ts');
const filesTab = read('src/components/FilesTab.tsx');
const css = read('src/styles.css');
const pkg = JSON.parse(read('package.json'));

// 1. Upstream count parsing.
assert.deepEqual(parseUpstreamCounts('3\t1\n'), { ahead: 3, behind: 1 });
assert.deepEqual(parseUpstreamCounts('0\t0\n'), { ahead: 0, behind: 0 });
assert.deepEqual(parseUpstreamCounts(''), { ahead: 0, behind: 0 });
assert.deepEqual(parseUpstreamCounts('nope\n'), { ahead: 0, behind: 0 });
console.log('ok - upstream count parsing');

// 2. Main IPC handlers.
for (const channel of ['mudex:git-branch', 'mudex:git-pull', 'mudex:git-push', 'mudex:git-clone']) {
  assert.ok(main.includes(channel), `main handles ${channel}`);
}
console.log('ok - main handlers');

// 3. Preload + renderer types.
for (const fn of ['gitBranch', 'gitPull', 'gitPush', 'gitClone']) {
  assert.ok(preload.includes(fn), `preload exposes ${fn}`);
  assert.ok(types.includes(fn), `types declare ${fn}`);
}
console.log('ok - bridge surface');

// 4. FilesTab remote chrome.
for (const token of ['현재 브랜치', 'aria-label="풀"', 'aria-label="푸시"', 'aria-label="클론"', 'aria-label="저장소 URL"', 'aria-label="클론 폴더"']) {
  assert.ok(filesTab.includes(token), `FilesTab renders ${token}`);
}
for (const cls of ['.git-branch', '.git-clone-dialog']) {
  assert.ok(css.includes(cls), `styles define ${cls}`);
}
console.log('ok - remote UI chrome');

// 5. Suite wiring.
assert.ok((pkg.scripts.test || '').includes('git-remote:test'), 'test chain includes git-remote');
assert.equal(pkg.scripts['git-remote:test'], 'node tests/git-remote-test.mjs');
console.log('ok - suite wiring');

console.log('GIT REMOTE TEST: ALL PASS');
