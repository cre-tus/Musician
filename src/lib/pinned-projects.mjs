import { normalizePathForComparison } from './path-utils.mjs';

const STORAGE_KEY = 'mudex:pinned-projects:v1';

export function normalizePinnedProjects(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const path = raw.trim();
    const key = normalizePathForComparison(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

export function togglePinnedProject(projects, projectPath) {
  const current = normalizePinnedProjects(projects);
  const key = normalizePathForComparison(projectPath);
  if (!key) return current;
  return current.some((path) => normalizePathForComparison(path) === key)
    ? current.filter((path) => normalizePathForComparison(path) !== key)
    : [...current, String(projectPath).trim()];
}

export function readPinnedProjects(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return normalizePinnedProjects(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writePinnedProjects(projects, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, JSON.stringify(normalizePinnedProjects(projects)));
  } catch {
    // Sidebar order remains usable even when preference storage is unavailable.
  }
}
