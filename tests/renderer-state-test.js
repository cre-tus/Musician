'use strict';
// File-backed durable store for high-value renderer state (editor drafts,
// navigation bookmarks). Crash-proof where Web Storage is not.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyStateSet, loadRendererState, saveRendererState, stateFilePath } = require('../electron/renderer-state');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-renderer-state-'));

(async () => {
  // 1. missing file loads as empty, never throws.
  assert.deepEqual(loadRendererState(path.join(tmp, 'fresh')), { ok: true, data: {} });

  // 2. round trip preserves keys and values.
  const dir = path.join(tmp, 'app');
  fs.mkdirSync(dir, { recursive: true }); // userData always exists in the app
  assert.equal(saveRendererState(dir, { a: '1', b: '{"x":2}' }).ok, true);
  assert.deepEqual(loadRendererState(dir), { ok: true, data: { a: '1', b: '{"x":2}' } });
  assert.equal(stateFilePath(dir), path.join(dir, 'renderer-state.json'));

  // 3. corrupt file loads as empty; a later save heals it.
  fs.writeFileSync(path.join(dir, 'renderer-state.json'), '{oops');
  assert.deepEqual(loadRendererState(dir), { ok: true, data: {} });
  assert.equal(saveRendererState(dir, { c: '3' }).ok, true);
  assert.deepEqual(loadRendererState(dir).data, { c: '3' });

  // 4. non-object JSON counts as corrupt.
  fs.writeFileSync(path.join(dir, 'renderer-state.json'), '[1,2]');
  assert.deepEqual(loadRendererState(dir), { ok: true, data: {} });

  // 5. pure set/delete semantics for the in-memory map.
  assert.deepEqual(applyStateSet({ a: '1' }, 'b', '2'), { a: '1', b: '2' });
  assert.deepEqual(applyStateSet({ a: '1', b: '2' }, 'a', null), { b: '2' });
  assert.deepEqual(applyStateSet({ a: '1' }, 'a', undefined), {});
  assert.deepEqual(applyStateSet('nope', 'a', '1'), { a: '1' });

  // 6. saves are atomic: no tmp litter, bad dir fails false.
  assert.equal(fs.readdirSync(dir).filter((n) => n.includes('tmp')).length, 0);
  assert.equal(saveRendererState(path.join(tmp, 'nope', 'deeper', 'x.json'), {}).ok, false);

  console.log('ok - renderer-state (6 cases)');
})();
