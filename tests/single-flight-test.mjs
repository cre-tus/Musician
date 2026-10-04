import assert from 'node:assert/strict';
import { createSingleFlight } from '../src/lib/single-flight.mjs';

const run = createSingleFlight();
let resolveFirst;
let calls = 0;
const first = run('c:/project/file.ts', () => {
  calls += 1;
  return new Promise((resolve) => { resolveFirst = resolve; });
});
const duplicate = run('c:/project/file.ts', () => { calls += 1; return 'wrong'; });
assert.equal(first, duplicate, 'same-key concurrent requests share the same promise');
assert.equal(calls, 0, 'task starts after it has been registered');
await Promise.resolve();
assert.equal(calls, 1);
resolveFirst('opened');
assert.equal(await first, 'opened');
assert.equal(await run('c:/project/file.ts', () => { calls += 1; return 'opened again'; }), 'opened again');
assert.equal(calls, 2, 'completed tasks do not block future requests');

await assert.rejects(run('retry', () => { throw new Error('temporary failure'); }), /temporary failure/);
assert.equal(await run('retry', () => 'recovered'), 'recovered', 'failed tasks can be retried');
console.log('Single-flight checks passed.');
