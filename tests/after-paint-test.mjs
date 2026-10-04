import assert from 'node:assert/strict';
import { scheduleAfterPaint } from '../src/lib/after-paint.mjs';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. No rAF (node): setTimeout fallback runs the task exactly once.
let runs = 0;
scheduleAfterPaint(() => { runs++; }, { timeoutMs: 5 });
await tick(30);
assert.equal(runs, 1, 'fallback runs the task once');

// 2. Cancel prevents the run.
runs = 0;
const cancel = scheduleAfterPaint(() => { runs++; }, { timeoutMs: 5 });
cancel();
await tick(30);
assert.equal(runs, 0, 'cancel suppresses the task');

// 3. Non-function task is a safe no-op.
assert.equal(typeof scheduleAfterPaint(null), 'function');

// 4. rAF present: rAF wins, the timeout is a guarded no-op.
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;
let rafCalls = 0;
globalThis.requestAnimationFrame = (cb) => { rafCalls++; cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};
try {
  runs = 0;
  scheduleAfterPaint(() => { runs++; }, { timeoutMs: 5 });
  await tick(30);
  assert.equal(rafCalls, 1, 'rAF path used when available');
  assert.equal(runs, 1, 'task runs exactly once with rAF present');
} finally {
  if (realRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = realRaf;
  if (realCaf === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = realCaf;
}

console.log('After-paint scheduling checks passed.');
