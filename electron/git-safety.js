'use strict';
// Pure guards for the git IPC handlers (branch/pull/push/clone/show).
// No Electron here so the rules stay unit-testable in git-safety-test.js.
const path = require('node:path');

// A repo-relative file path is safe when it cannot escape the workdir:
// non-empty, relative, and without parent traversal or NUL bytes.
function isSafeRepoRelativePath(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.includes('\0')) return false;
  if (path.isAbsolute(s)) return false;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(s)) return false;
  return true;
}

// `git clone <source> <target>` runs source as one argv element (no shell),
// but a source starting with '-' is still parsed as a clone OPTION
// (e.g. `--upload-pack=...`), which is a command-execution primitive.
// Reject option-looking sources; URLs and local paths never start with '-'.
function isSafeCloneSource(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length > 2000 || s.includes('\0')) return false;
  if (s.startsWith('-')) return false;
  return true;
}

// `git remote get-url` output is shown in the branch tooltip. HTTPS remotes
// may embed credentials (https://user:token@host/...); strip the userinfo
// so tokens never reach the screen, screenshots, or shared logs.
// scp-style remotes (user@host:path) carry no password and pass through.
function redactRemoteUrl(value) {
  const s = String(value || '').trim().slice(0, 300);
  if (!s) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      return u.toString();
    }
    return s;
  } catch {
    return s;
  }
}

// Branch names ride as one argv element to `git switch` / `git switch -c`
// (no shell), but a name starting with '-' would parse as a git OPTION.
// Allow the everyday branch charset only; git rejects the rest anyway.
function isSafeBranchName(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length > 250 || s.includes('\0')) return false;
  if (s.startsWith('-') || s.startsWith('/')) return false;
  if (!/^[A-Za-z0-9._/\-]+$/.test(s)) return false;
  if (s.includes('..') || s.includes('//') || s.endsWith('/') || s.endsWith('.lock')) return false;
  return true;
}

module.exports = { isSafeRepoRelativePath, isSafeCloneSource, redactRemoteUrl, isSafeBranchName };
