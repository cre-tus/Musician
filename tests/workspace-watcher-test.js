'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceWatcher } = require('../electron/workspace-watcher');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-watch-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-watch-outside-'));
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  const events = [];
  const watcher = new WorkspaceWatcher({ onChange: (event) => events.push(event) });
  try {
    assert.equal(watcher.watch(root, root).ok, true);
    assert.equal(watcher.watch(root, nested).ok, true);
    assert.equal(watcher.watch(root, outside).error, 'OUTSIDE_WORKSPACE');
    fs.writeFileSync(path.join(root, 'root.txt'), 'changed');
    fs.writeFileSync(path.join(nested, 'nested.txt'), 'changed');
    const deadline = Date.now() + 3000;
    while (events.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert(events.some((event) => event.path === path.join(root, 'root.txt')));
    assert(events.some((event) => event.path === path.join(nested, 'nested.txt')));
    watcher.unwatch(root, root);
    assert.equal(watcher.watchers.size, 1);
    watcher.closeAll();
    assert.equal(watcher.watchers.size, 0);
    console.log('Workspace watcher checks passed.');
  } finally {
    watcher.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
