import assert from 'node:assert/strict';
import { nextRecentTab, touchRecentTab } from '../src/lib/recent-tab-history.mjs';

assert.deepEqual(touchRecentTab([], 'a', ['a', 'b']), ['a']);
assert.deepEqual(touchRecentTab(['b', 'a', 'closed'], 'c', ['a', 'b', 'c']), ['c', 'b', 'a']);
assert.deepEqual(touchRecentTab(['b', 'a'], '', ['a', 'b']), ['b', 'a']);
assert.equal(nextRecentTab(['c', 'b', 'a'], 'c', ['a', 'b', 'c']), 'b');
assert.equal(nextRecentTab(['c', 'b', 'a'], 'c', ['a', 'b', 'c'], -1), 'a');
assert.equal(nextRecentTab(['c', 'closed', 'a'], 'c', ['a', 'c']), 'a');
assert.equal(nextRecentTab(['a'], 'a', ['a']), null);

console.log('Recent tab history checks passed.');
