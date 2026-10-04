import assert from 'node:assert/strict';
import { findTextMatchRanges } from '../src/lib/text-match-ranges.mjs';

assert.deepEqual(findTextMatchRanges('Foo food FOO', 'foo'), [
  { start: 0, end: 3 },
  { start: 4, end: 7 },
  { start: 9, end: 12 },
]);
assert.deepEqual(findTextMatchRanges('Foo food FOO', 'foo', true), [
  { start: 4, end: 7 },
]);
assert.deepEqual(findTextMatchRanges('Foo food seafood', 'foo', false, true), [
  { start: 0, end: 3 },
]);
assert.deepEqual(findTextMatchRanges('🐈 Cat CAT', 'cat'), [
  { start: 3, end: 6 },
  { start: 7, end: 10 },
]);
assert.deepEqual(findTextMatchRanges('한글 검색 결과', '검색'), [
  { start: 3, end: 5 },
]);
assert.deepEqual(findTextMatchRanges('No match', 'needle'), []);
assert.deepEqual(findTextMatchRanges('anything', ''), []);

console.log('Search result highlighting checks passed.');
