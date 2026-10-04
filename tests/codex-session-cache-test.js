'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createProjectSessionCache } = require('../electron/codex-session-cache');

let now = 1000;
let loads = 0;
const cache = createProjectSessionCache((cwd) => [{ cwd, version: ++loads }], { ttlMs: 100, maxEntries: 2, now: () => now });
const project = path.join(process.cwd(), 'sample-project');

const first = cache.get(project);
assert.equal(first[0].version, 1);
assert.equal(cache.get(project), first, 'same project should reuse the indexed rollout list');
assert.equal(loads, 1);

assert.equal(cache.get(`${project}-other`)[0].version, 2, 'different projects must not share sessions');
assert.equal(cache.get(project, { refresh: true })[0].version, 3, 'explicit refresh should re-scan immediately');
now += 101;
assert.equal(cache.get(project)[0].version, 4, 'expired entries should refresh automatically');

cache.get(`${project}-third`);
cache.get(`${project}-fourth`);
assert.equal(cache.get(project)[0].version, 7, 'old projects should be evicted instead of growing memory without bound');
assert.equal(loads, 7);
cache.clear();
assert.deepEqual(cache.get(''), []);

let caseLoads = 0;
const caseCache = createProjectSessionCache((cwd) => [{ cwd, version: ++caseLoads }]);
const mixedCasePath = path.join(process.cwd(), 'CaseSensitiveProject');
const lowerCasePath = path.join(process.cwd(), 'casesensitiveproject');
caseCache.get(mixedCasePath);
caseCache.get(lowerCasePath);
assert.equal(caseLoads, process.platform === 'win32' ? 1 : 2, 'cache keys should follow the current platform path case rules');
const filesystemRoot = path.parse(process.cwd()).root;
assert.ok(caseCache.get(filesystemRoot).length > 0, 'filesystem roots should remain valid cache keys');

console.log('Codex project session cache checks passed.');
