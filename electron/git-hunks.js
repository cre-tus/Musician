'use strict';
// Selective hunk apply/restore: parse `git diff -U3` into per-file hunks
// and rebuild single-hunk patches for `git apply --reverse` (discard) or
// `git apply --cached` (stage). Pure functions; tested in
// tests/git-hunks-test.mjs. The main process always re-parses a fresh diff
// and validates hunk lines, so renderer-supplied indices cannot inject
// patch content.
const HUNK_FILE_MAX = 20;
const HUNKS_PER_FILE_MAX = 50;
const HUNK_HEAD_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

function stripGitPrefix(p) {
  const s = String(p || '').trim();
  if (!s || s === '/dev/null') return '';
  const unquoted = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  return unquoted.replace(/^[ab]\//, '');
}

function splitDiffFiles(diffText) {
  const rawLines = String(diffText || '').split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const files = [];
  let cur = null;
  for (const line of rawLines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur);
      const m = line.match(/^diff --git ("[^"]+"|\S+) ("[^"]+"|\S+)\s*$/);
      const bRaw = m ? m[2] : '';
      cur = { file: stripGitPrefix(bRaw), header: [], hunks: [] };
      continue;
    }
    if (!cur) continue;
    if (HUNK_HEAD_RE.test(line)) {
      cur.hunks.push({ head: line, lines: [] });
    } else if (cur.hunks.length === 0) {
      cur.header.push(line);
    } else {
      cur.hunks[cur.hunks.length - 1].lines.push(line);
    }
  }
  if (cur) files.push(cur);
  return files;
}

// Full parse, capped. Header lines exclude the `diff --git` delimiter;
// buildHunkPatch re-synthesizes it.
function parseDiffHunks(diffText) {
  return splitDiffFiles(diffText)
    .filter((f) => f.file)
    .slice(0, HUNK_FILE_MAX)
    .map((f) => ({ file: f.file, header: f.header.slice(0, 8), hunks: f.hunks.slice(0, HUNKS_PER_FILE_MAX) }));
}

function isSafeHunkLine(line) {
  const s = String(line == null ? '' : line);
  if (s === '') return true; // blank context line
  if (s.startsWith('\\')) return s.startsWith('\\ No newline');
  return s[0] === ' ' || s[0] === '+' || s[0] === '-';
}

function quoteDiffPath(file) {
  const s = String(file || '');
  return /[\s"\\]/.test(s) ? `"a/${s.replace(/"/g, '\\"')}" "b/${s.replace(/"/g, '\\"')}"` : `a/${s} b/${s}`;
}

// Rebuild a self-contained single-hunk patch. Returns null when the hunk
// fails validation — never emit a half-valid patch.
function buildHunkPatch(file, header, hunk) {
  try {
    if (!file || typeof file !== 'string' || file.includes('..')) return null;
    if (!hunk || !HUNK_HEAD_RE.test(String(hunk.head || ''))) return null;
    const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
    if (lines.length === 0) return null;
    for (const line of lines) {
      if (!isSafeHunkLine(line)) return null;
    }
    const head = Array.isArray(header) ? header.filter((l) => typeof l === 'string') : [];
    const out = [`diff --git ${quoteDiffPath(file)}`, ...head, String(hunk.head), ...lines.map(String)];
    return `${out.join('\n')}\n`;
  } catch {
    return null;
  }
}

function hunkStats(hunk) {
  let added = 0;
  let removed = 0;
  for (const line of Array.isArray(hunk && hunk.lines) ? hunk.lines : []) {
    const s = String(line == null ? '' : line);
    if (s.startsWith('+') && !s.startsWith('+++')) added += 1;
    else if (s.startsWith('-') && !s.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

module.exports = {
  HUNK_FILE_MAX,
  HUNKS_PER_FILE_MAX,
  buildHunkPatch,
  hunkStats,
  isSafeHunkLine,
  parseDiffHunks,
};
