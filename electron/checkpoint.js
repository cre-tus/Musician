// Turn checkpoints: snapshot the workspace before an assistant turn so the
// turn can be undone wholesale ("되돌리기"). Two modes:
// - git repo: `git stash create` (commit object, no working-tree touch) pins
//   tracked files; untracked files are copied aside (capped).
// - plain folder: capped recursive copy (junk dirs skipped).
// Retention: newest CHECKPOINT_KEEP per session; older pruned on create.
// All entry points return { ok, ... } and never throw.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHECKPOINT_KEEP = 20;
const CHECKPOINT_ID_RE = /^cp-[a-z0-9]+-[a-z0-9]+$/;
const MAX_UNTRACKED_FILES = 100;
const MAX_UNTRACKED_BYTES = 10 * 1024 * 1024;
const MAX_COPY_FILES = 1000;
const MAX_COPY_BYTES = 50 * 1024 * 1024;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', 'release', 'release-final',
  '.next', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', '.idea', '.vscode',
]);

function isSafeCheckpointId(id) {
  return typeof id === 'string' && CHECKPOINT_ID_RE.test(id);
}

function isSafeRelative(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= 500 &&
    !p.includes('..') && !path.isAbsolute(p) && !/[\0]/.test(p);
}

function checkpointRoot(userData) {
  return path.join(String(userData || ''), 'checkpoints');
}

function sessionDir(userData, sessionId) {
  return path.join(checkpointRoot(userData), String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_'));
}

function makeId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cp-${Date.now().toString(36)}-${rand}`;
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(String(name));
}

// Porcelain v1 line -> { path, staged, unstaged }. Consumes the same shape
// as gitStatus; quoted paths are unquoted minimally ( \" -> " ).
function parsePorcelainLine(line) {
  const m = /^(.{2}) (.+)$/.exec(String(line || ''));
  if (!m) return null;
  let p = m[2].trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\"/g, '"');
  return { path: p, x: m[1][0], y: m[1][1] };
}

// Files needing deletion on restore: untracked now, absent from the
// before-set (tracked-before ∪ untracked-before).
function diffNewFiles(beforeSet, nowUntracked) {
  const before = beforeSet instanceof Set ? beforeSet : new Set();
  const out = [];
  for (const f of Array.isArray(nowUntracked) ? nowUntracked : []) {
    if (typeof f !== 'string' || !f) continue;
    if (!before.has(f) && isSafeRelative(f)) out.push(f);
  }
  return out;
}

function pruneList(names, keep) {
  const list = (Array.isArray(names) ? names : []).filter(isSafeCheckpointId).sort();
  const n = Number.isInteger(keep) && keep > 0 ? keep : CHECKPOINT_KEEP;
  if (list.length <= n) return [];
  return list.slice(0, list.length - n);
}

async function gitOut(runGit, cwd, args) {
  try {
    const r = await runGit(cwd, args);
    if (!r || !r.ok) return null;
    return String(r.stdout == null ? '' : r.stdout);
  } catch {
    return null;
  }
}

function copyFileInto(absSrc, destRoot, rel) {
  const dest = path.join(destRoot, rel);
  if (path.relative(destRoot, dest).startsWith('..')) return { ok: false, error: 'BAD_PATH' };
  try {
    const st = fs.statSync(absSrc);
    if (!st.isFile()) return { ok: false, error: 'NOT_A_FILE' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absSrc, dest);
    return { ok: true, bytes: st.size };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function walkFiles(root, budget) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    if (out.length >= budget.files || budget.bytes <= 0) return { files: out, truncated: true };
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      if (size > budget.bytes || out.length >= budget.files) return { files: out, truncated: true };
      budget.bytes -= size;
      out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), bytes: size });
    }
  }
  return { files: out, truncated: false };
}

async function createCheckpoint({ userData, cwd, sessionId, runGit }) {
  try {
    if (!cwd || !sessionId || typeof runGit !== 'function') return { ok: false, error: 'BAD_ARGS' };
    const root = path.resolve(String(cwd));
    try {
      if (!fs.statSync(root).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
    } catch {
      return { ok: false, error: 'NOT_A_DIRECTORY' };
    }
    const id = makeId();
    const dir = path.join(sessionDir(userData, sessionId), id);
    fs.mkdirSync(dir, { recursive: true });
    const isRepo = (await gitOut(runGit, root, ['rev-parse', '--is-inside-work-tree'])) !== null;
    let meta;
    const headRaw = isRepo ? await gitOut(runGit, root, ['rev-parse', 'HEAD']) : null;
    const stashRaw = isRepo ? await gitOut(runGit, root, ['stash', 'create']) : null;
    const gitHead = headRaw ? headRaw.trim() || null : null;
    const stashHash = stashRaw ? stashRaw.trim() || null : null;
    // Unborn HEAD (no commits yet): nothing pins tracked files, so fall back
    // to copy mode for full coverage.
    const useGit = isRepo && (stashHash || gitHead);
    if (useGit) {
      const statusRaw = await gitOut(runGit, root, ['status', '--porcelain=v1', '-uall']);
      const tracked = new Set();
      const untracked = [];
      for (const line of String(statusRaw || '').split('\n')) {
        const e = parsePorcelainLine(line);
        if (!e || !isSafeRelative(e.path)) continue;
        if (e.x === '?' && e.y === '?') untracked.push(e.path);
        else tracked.add(e.path);
      }
      // Tracked-but-clean files need no copy: the stash commit pins them.
      // Untracked files are outside git: copy aside (capped).
      const copies = [];
      let bytes = 0;
      for (const rel of untracked.slice(0, MAX_UNTRACKED_FILES)) {
        const r = copyFileInto(path.join(root, rel), path.join(dir, 'untracked'), rel);
        if (!r.ok) continue;
        bytes += r.bytes || 0;
        if (bytes > MAX_UNTRACKED_BYTES) break;
        copies.push(rel);
      }
      const lsRaw = await gitOut(runGit, root, ['ls-files']);
      const beforeSet = new Set(
        String(lsRaw || '').split('\n').map((s) => s.trim()).filter((s) => s && isSafeRelative(s)),
      );
      for (const u of untracked) beforeSet.add(u);
      meta = {
        id, ts: Date.now(), sessionId: String(sessionId), cwd: root, mode: 'git',
        gitHead,
        // Dirty tree: the stash commit pins worktree+index. Clean tree: HEAD
        // pins it (`stash create` returns empty when there is no dirt).
        restoreHash: stashHash || gitHead,
        before: [...beforeSet].sort(),
        untrackedCopies: copies,
      };
    } else {
      const budget = { files: MAX_COPY_FILES, bytes: MAX_COPY_BYTES };
      const { files, truncated } = walkFiles(root, budget);
      if (truncated) {
        fs.rmSync(dir, { recursive: true, force: true });
        return { ok: false, error: 'SNAPSHOT_TOO_BIG' };
      }
      const copied = [];
      for (const f of files) {
        const r = copyFileInto(path.join(root, f.rel), path.join(dir, 'tree'), f.rel);
        if (r.ok) copied.push(f.rel);
      }
      meta = {
        id, ts: Date.now(), sessionId: String(sessionId), cwd: root, mode: 'copy',
        before: copied.sort(),
      };
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf8');
    // Retention: prune oldest beyond CHECKPOINT_KEEP for this session.
    try {
      const names = fs.readdirSync(path.dirname(dir));
      for (const victim of pruneList(names, CHECKPOINT_KEEP)) {
        fs.rmSync(path.join(path.dirname(dir), victim), { recursive: true, force: true });
      }
    } catch {
      /* pruning is best-effort */
    }
    return { ok: true, id, mode: meta.mode };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function loadMeta(userData, sessionId, id) {
  if (!isSafeCheckpointId(id)) return { ok: false, error: 'BAD_ID' };
  const dir = path.join(sessionDir(userData, sessionId), id);
  const root = checkpointRoot(userData);
  if (path.relative(root, dir).startsWith('..')) return { ok: false, error: 'BAD_ID' };
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    return { ok: false, error: 'NOT_FOUND' };
  }
  if (!meta || meta.id !== id || meta.sessionId !== String(sessionId)) return { ok: false, error: 'MISMATCH' };
  return { ok: true, meta, dir };
}

async function restoreCheckpoint({ userData, cwd, sessionId, id, runGit }) {
  try {
    if (!cwd || !sessionId || !isSafeCheckpointId(id) || typeof runGit !== 'function') {
      return { ok: false, error: 'BAD_ARGS' };
    }
    const loaded = loadMeta(userData, sessionId, id);
    if (!loaded.ok) return loaded;
    const { meta, dir } = loaded;
    const root = path.resolve(String(cwd));
    try {
      if (!fs.statSync(root).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
    } catch {
      return { ok: false, error: 'NOT_A_DIRECTORY' };
    }
    const restored = [];
    const deleted = [];
    const failed = [];
    if (meta.mode === 'git') {
      if (meta.restoreHash) {
        const r = await gitOut(runGit, root, ['checkout', String(meta.restoreHash), '--', '.']);
        if (r === null) return { ok: false, error: 'CHECKOUT_FAILED' };
      }
      // Unstage everything first: files the turn staged (incl. `git add` of
      // new files) surface as untracked below and are cleaned up. Pre-turn
      // staged content is preserved as worktree changes, not as index entries.
      await gitOut(runGit, root, ['reset', '-q']);
      // Untracked-before files: copy back (turn may have edited/deleted them).
      for (const rel of Array.isArray(meta.untrackedCopies) ? meta.untrackedCopies : []) {
        if (!isSafeRelative(rel)) continue;
        const src = path.join(dir, 'untracked', rel);
        const dest = path.join(root, rel);
        if (path.relative(root, dest).startsWith('..') || !fs.existsSync(src)) {
          failed.push(rel);
          continue;
        }
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          restored.push(rel);
        } catch {
          failed.push(rel);
        }
      }
      // Files born after the checkpoint: delete (turn-created untracked).
      const statusRaw = await gitOut(runGit, root, ['status', '--porcelain=v1', '-uall']);
      const nowUntracked = [];
      for (const line of String(statusRaw || '').split('\n')) {
        const e = parsePorcelainLine(line);
        if (e && e.x === '?' && e.y === '?' && isSafeRelative(e.path)) nowUntracked.push(e.path);
      }
      const beforeSet = new Set(Array.isArray(meta.before) ? meta.before : []);
      for (const rel of diffNewFiles(beforeSet, nowUntracked)) {
        const abs = path.join(root, rel);
        if (path.relative(root, abs).startsWith('..')) continue;
        try {
          if (fs.statSync(abs).isFile()) {
            fs.unlinkSync(abs);
            deleted.push(rel);
          }
        } catch {
          failed.push(rel);
        }
      }
    } else if (meta.mode === 'copy') {
      const want = new Set(Array.isArray(meta.before) ? meta.before : []);
      for (const rel of want) {
        if (!isSafeRelative(rel)) continue;
        const src = path.join(dir, 'tree', rel);
        const dest = path.join(root, rel);
        if (path.relative(root, dest).startsWith('..') || !fs.existsSync(src)) {
          failed.push(rel);
          continue;
        }
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          restored.push(rel);
        } catch {
          failed.push(rel);
        }
      }
      const budget = { files: MAX_COPY_FILES + 1, bytes: Number.MAX_SAFE_INTEGER };
      const { files } = walkFiles(root, budget);
      for (const f of files) {
        if (want.has(f.rel) || !isSafeRelative(f.rel)) continue;
        try {
          fs.unlinkSync(path.join(root, f.rel));
          deleted.push(f.rel);
        } catch {
          /* best-effort */
        }
      }
    } else {
      return { ok: false, error: 'BAD_MODE' };
    }
    if (failed.length > 0) return { ok: false, error: 'PARTIAL', restored, deleted, failed };
    return { ok: true, restored, deleted };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

module.exports = {
  CHECKPOINT_KEEP,
  isSafeCheckpointId,
  parsePorcelainLine,
  diffNewFiles,
  pruneList,
  shouldSkipDir,
  makeId,
  createCheckpoint,
  restoreCheckpoint,
};
