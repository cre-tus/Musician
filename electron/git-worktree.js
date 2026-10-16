'use strict';
// Git worktree management: list/add/remove without leaving the app.
// Parsing and input validation are pure and unit-tested in
// tests/git-worktree-test.mjs; the main process only executes git.
const WT_BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

function shortRef(ref) {
  const s = String(ref || '');
  return s.startsWith('refs/heads/') ? s.slice('refs/heads/'.length) : s;
}

function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.path) out.push(cur);
    cur = null;
  };
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      cur = { path: line.slice('worktree '.length).trim(), head: '', branch: '', bare: false, detached: false };
    } else if (cur && line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim().slice(0, 40);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = shortRef(line.slice('branch '.length).trim());
    } else if (cur && line === 'bare') {
      cur.bare = true;
    } else if (cur && line === 'detached') {
      cur.detached = true;
    }
  }
  flush();
  return out;
}

function isValidWtBranch(name) {
  const s = String(name || '').trim();
  if (!s) return true; // optional: omitted means detached HEAD
  if (!WT_BRANCH_RE.test(s)) return false;
  if (s.startsWith('-') || s.startsWith('/') || s.endsWith('/') || s.includes('..')) return false;
  return true;
}

module.exports = { isValidWtBranch, parseWorktreeList };
