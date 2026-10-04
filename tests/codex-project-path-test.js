'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectPathMatcher } = require('../electron/project-path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-project-match-'));
try {
  const repo = path.join(tempRoot, 'workspace');
  const nested = path.join(repo, 'packages', 'app');
  const sibling = path.join(repo, 'packages', 'tools');
  const otherRepo = path.join(tempRoot, 'workspace-tools');
  const nonGit = path.join(tempRoot, 'notes');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  fs.mkdirSync(path.join(otherRepo, '.git'), { recursive: true });
  fs.mkdirSync(otherRepo, { recursive: true });
  fs.mkdirSync(path.join(nonGit, 'child'), { recursive: true });

  const matcher = createProjectPathMatcher();
  assert.equal(matcher.samePath(repo, repo), true);
  assert.equal(matcher.sameProjectPath(repo, nested), true, 'nested folders in the same Git project should match');
  assert.equal(matcher.sameProjectPath(nested, sibling), true, 'subfolders in one repository should match');
  assert.equal(matcher.sameProjectPath(repo, otherRepo), false, 'separate repositories with similar names must not match');
  assert.equal(matcher.sameProjectPath(nonGit, path.join(nonGit, 'child')), false, 'non-Git folders should require an exact match');
  matcher.clear();
  assert.equal(matcher.sameProjectPath(repo, nested), true, 'clearing cached roots should not change project matching');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Codex project path matching checks passed.');
