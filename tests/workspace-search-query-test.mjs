import assert from 'node:assert/strict';
import { prefillWorkspaceSearchQuery } from '../src/lib/workspace-search-query.mjs';

assert.equal(prefillWorkspaceSearchQuery('  selectedName  '), 'selectedName');
assert.equal(prefillWorkspaceSearchQuery('검색어'), '검색어');
assert.equal(prefillWorkspaceSearchQuery(''), '');
assert.equal(prefillWorkspaceSearchQuery('  '), '');
assert.equal(prefillWorkspaceSearchQuery('first\nsecond'), '');
assert.equal(prefillWorkspaceSearchQuery('x'.repeat(241)), '');
assert.equal(prefillWorkspaceSearchQuery('x'.repeat(240)), 'x'.repeat(240));
console.log('workspace search query tests passed');
