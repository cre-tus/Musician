'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createProjectPathMatcher() {
  const gitRootCache = new Map();

  function normalize(value) {
    const resolved = path.resolve(String(value || ''));
    const root = path.parse(resolved).root;
    const trimmed = resolved === root ? root : resolved.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
  }

  function samePath(a, b) {
    return !!a && !!b && normalize(a) === normalize(b);
  }

  function gitRoot(value) {
    if (!value) return null;
    let current = path.resolve(String(value));
    const visited = [];
    let result = null;
    while (true) {
      const key = normalize(current);
      if (gitRootCache.has(key)) {
        result = gitRootCache.get(key);
        break;
      }
      visited.push(current);
      try {
        const stat = fs.statSync(path.join(current, '.git'));
        if (stat.isDirectory() || stat.isFile()) {
          result = current;
          break;
        }
      } catch { /* this directory is not a Git root */ }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const candidate of visited) gitRootCache.set(normalize(candidate), result);
    return result;
  }

  function sameProjectPath(a, b) {
    if (!a || !b) return false;
    if (samePath(a, b)) return true;
    const rootA = gitRoot(a);
    const rootB = gitRoot(b);
    return !!rootA && !!rootB && samePath(rootA, rootB);
  }

  return { samePath, sameProjectPath, clear: () => gitRootCache.clear() };
}

module.exports = { createProjectPathMatcher };
