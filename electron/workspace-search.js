'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function fuzzyScore(query, candidate) {
  const needle = String(query || '').normalize('NFKC').toLocaleLowerCase();
  const value = String(candidate || '').normalize('NFKC').toLocaleLowerCase();
  if (!needle || !value) return -1;
  if (value === needle) return 1200;
  if (value.startsWith(needle)) return 1000 - value.length * 0.1;
  const at = value.indexOf(needle);
  if (at >= 0) return 800 - at * 3 - value.length * 0.1;
  let cursor = 0;
  let first = -1;
  let gaps = 0;
  for (const char of needle) {
    const found = value.indexOf(char, cursor);
    if (found < 0) return -1;
    if (first < 0) first = found;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return Math.max(1, 500 - first * 4 - gaps * 4 - value.length * 0.1);
}

function globToRegExp(pattern) {
  const normalized = String(pattern || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

function compilePathFilter(options = {}) {
  const compile = (value) => String(value || '').split(',').map((pattern) => pattern.trim()).filter(Boolean).map((pattern) => ({
    regex: globToRegExp(pattern),
    basenameOnly: !pattern.replace(/\\/g, '/').includes('/'),
  }));
  const includes = compile(options.include);
  const excludes = compile(options.exclude);
  const matchesAny = (patterns, relativePath) => patterns.some(({ regex, basenameOnly }) => regex.test(basenameOnly ? path.posix.basename(relativePath) : relativePath));
  return (relativePath) => (!includes.length || matchesAny(includes, relativePath)) && !matchesAny(excludes, relativePath);
}

async function searchFiles(cwd, query, options = {}) {
  const terms = String(query || '').trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!cwd || !terms.length) return { ok: true, files: [], truncated: false };
  if (terms.some((term) => term.length > 240)) return { ok: false, error: 'QUERY_TOO_LONG' };
  const isCancelled = typeof options?.isCancelled === 'function' ? options.isCancelled : null;
  if (isCancelled?.()) return { ok: false, error: 'CANCELLED' };
  try {
    const root = await fs.realpath(path.resolve(String(cwd)));
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
    const isPathAllowed = compilePathFilter(options);
    const ignored = new Set(['.git', 'node_modules', '.next', '.vite', 'dist', 'out', 'target', '.venv', 'venv', '__pycache__', 'coverage']);
    const stack = [root];
    const files = [];
    const maxVisited = 24000;
    const maxResults = 180;
    const deadline = Date.now() + 700;
    let visited = 0;
    while (stack.length && visited < maxVisited && Date.now() < deadline) {
      if (isCancelled?.()) return { ok: false, error: 'CANCELLED' };
      const dir = stack.pop();
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        visited++;
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name.toLowerCase())) stack.push(path.join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
        if (!isPathAllowed(relativePath)) continue;
        const lowerBase = entry.name.normalize('NFKC').toLocaleLowerCase();
        const lowerPath = relativePath.normalize('NFKC').toLocaleLowerCase();
        let score = 0;
        let matches = true;
        for (const term of terms) {
          const baseScore = fuzzyScore(term, lowerBase);
          const rawPathScore = fuzzyScore(term, lowerPath);
          const pathScore = rawPathScore < 0 ? -1 : Math.max(1, rawPathScore - 100);
          const best = Math.max(baseScore, pathScore);
          if (best < 0) { matches = false; break; }
          score += best;
        }
        if (matches) files.push({ path: fullPath, relativePath, score });
        if (visited >= maxVisited || Date.now() >= deadline) break;
      }
    }
    files.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
    const truncated = stack.length > 0 || visited >= maxVisited || Date.now() >= deadline || files.length > maxResults;
    return { ok: true, files: files.slice(0, maxResults).map(({ path: filePath, relativePath }) => ({ path: filePath, relativePath })), truncated };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function containsWholeWord(line, needle, caseSensitive) {
  const source = caseSensitive ? line : line.toLocaleLowerCase();
  const term = caseSensitive ? needle : needle.toLocaleLowerCase();
  const isWordCharacter = (character) => !!character && /[\\p{L}\\p{N}_]/u.test(character);
  let offset = 0;
  while (offset <= source.length - term.length) {
    const index = source.indexOf(term, offset);
    if (index < 0) return false;
    const before = index > 0 ? Array.from(source.slice(Math.max(0, index - 2), index)).at(-1) : '';
    const after = Array.from(source.slice(index + term.length, index + term.length + 2))[0] || '';
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    offset = index + Math.max(1, term.length);
  }
  return false;
}

async function searchInFiles(cwd, query, options = {}) {
  const rawQuery = String(query || '').trim();
  if (!cwd || !rawQuery) return { ok: true, matches: [], truncated: false };
  if (rawQuery.length > 240) return { ok: false, error: 'QUERY_TOO_LONG' };
  const isCancelled = typeof options?.isCancelled === 'function' ? options.isCancelled : null;
  if (isCancelled?.()) return { ok: false, error: 'CANCELLED' };
  try {
    const root = await fs.realpath(path.resolve(String(cwd)));
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
    const caseSensitive = options?.caseSensitive === true;
    const wholeWord = options?.wholeWord === true;
    const isPathAllowed = compilePathFilter(options);
    const needle = caseSensitive ? rawQuery : rawQuery.toLocaleLowerCase();
    const ignored = new Set(['.git', 'node_modules', '.next', '.vite', 'dist', 'out', 'target', '.venv', 'venv', '__pycache__', 'coverage']);
    const stack = [root];
    const matches = [];
    const maxVisited = 12000;
    const maxFileBytes = 512 * 1024;
    const maxTotalBytes = 12 * 1024 * 1024;
    const maxMatches = 240;
    const deadline = Date.now() + 1200;
    let visited = 0;
    let bytesRead = 0;
    let skippedBySizeLimit = false;
    while (stack.length && visited < maxVisited && matches.length < maxMatches && bytesRead < maxTotalBytes && Date.now() < deadline) {
      if (isCancelled?.()) return { ok: false, error: 'CANCELLED' };
      const dir = stack.pop();
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        visited++;
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name.toLowerCase())) stack.push(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
          if (!isPathAllowed(relativePath)) continue;
          let stat;
          try { stat = await fs.lstat(fullPath); } catch { continue; }
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) continue;
          if (stat.size > maxFileBytes || bytesRead + stat.size > maxTotalBytes) {
            skippedBySizeLimit = true;
            continue;
          }
          let buffer;
          try { buffer = await fs.readFile(fullPath); } catch { continue; }
          bytesRead += buffer.length;
          if (buffer.includes(0)) continue;
          const lines = buffer.toString('utf8').split(/\r?\n/);
          let fileHits = 0;
          for (let i = 0; i < lines.length && fileHits < 4 && matches.length < maxMatches; i++) {
            const line = lines[i];
            const haystack = caseSensitive ? line : line.toLocaleLowerCase();
            if (wholeWord ? !containsWholeWord(line, rawQuery, caseSensitive) : !haystack.includes(needle)) continue;
            const trimmedLine = line.trim();
            matches.push({ path: fullPath, relativePath, lineNumber: i + 1, lineText: trimmedLine.length > 240 ? `${trimmedLine.slice(0, 237)}…` : trimmedLine });
            fileHits++;
          }
        }
        if (matches.length >= maxMatches || visited >= maxVisited || bytesRead >= maxTotalBytes || Date.now() >= deadline) break;
      }
    }
    const truncated = skippedBySizeLimit || stack.length > 0 || visited >= maxVisited || bytesRead >= maxTotalBytes || Date.now() >= deadline || matches.length >= maxMatches;
    return { ok: true, matches, truncated };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

module.exports = { searchFiles, searchInFiles };
