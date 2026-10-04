import assert from 'node:assert/strict';
import {
  enqueuePrompt,
  extractQueuedPrompt,
  moveQueuedPrompt,
  normalizePromptQueue,
  removeQueuedPrompt,
  shouldAutoRunQueuedPrompt,
  takeNextPrompt,
} from '../src/lib/prompt-queue.mjs';

assert.deepEqual(normalizePromptQueue([' first ', '', 2, 'second']), [' first ', 'second']);
assert.deepEqual(enqueuePrompt(['first'], ' second ', 2), ['first', 'second']);
assert.deepEqual(enqueuePrompt(['first', 'second'], 'third', 2), ['first', 'second']);
assert.deepEqual(removeQueuedPrompt(['first', 'second', 'third'], 1), ['first', 'third']);
assert.deepEqual(removeQueuedPrompt(['first'], 4), ['first']);
assert.deepEqual(extractQueuedPrompt(['first', 'second'], 1), { prompt: 'second', remaining: ['first'] });
assert.deepEqual(extractQueuedPrompt(['first'], -1), { prompt: null, remaining: ['first'] });
assert.deepEqual(moveQueuedPrompt(['first', 'second', 'third'], 1, -1), ['second', 'first', 'third']);
assert.deepEqual(moveQueuedPrompt(['first', 'second', 'third'], 1, 1), ['first', 'third', 'second']);
assert.deepEqual(moveQueuedPrompt(['first', 'second'], 0, -1), ['first', 'second']);
assert.deepEqual(takeNextPrompt(['first', 'second']), { prompt: 'first', remaining: ['second'] });
assert.deepEqual(takeNextPrompt([]), { prompt: null, remaining: [] });

const finished = { wasRunning: true, completedSuccessfully: true, cancelled: false, queueLength: 1 };
assert.equal(shouldAutoRunQueuedPrompt(finished), true);
assert.equal(shouldAutoRunQueuedPrompt({ ...finished, cancelled: true }), false);
assert.equal(shouldAutoRunQueuedPrompt({ ...finished, completedSuccessfully: false }), false);
assert.equal(shouldAutoRunQueuedPrompt({ ...finished, wasRunning: false }), false);
assert.equal(shouldAutoRunQueuedPrompt({ ...finished, queueLength: 0 }), false);
assert.equal(shouldAutoRunQueuedPrompt({ ...finished, queuePaused: true }), false);

console.log('Prompt queue checks passed.');
