// Project memory: small durable notes scoped to a project folder, injected
// into every turn like goal context. Storage mirrors the goals store
// (localStorage JSON, validated on load). Injection is capped and labeled
// so the wire stays honest about what rode along.
export const STORAGE_KEY = 'mudex:project-memory:v1';
export const MAX_MEMORIES = 200;
export const MAX_PER_PROJECT = 20;
export const MAX_MEMORY_TEXT = 2000;
export const WIRE_CAP = 1000;

function cleanText(text) {
  return typeof text === 'string' ? text.trim().slice(0, MAX_MEMORY_TEXT) : '';
}

function isValidMemory(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.cwd === 'string' &&
    value.cwd.length > 0 &&
    typeof value.text === 'string' &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt)
  );
}

export function normalizeProjectMemories(value, limit = MAX_MEMORIES) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of list) {
    if (!isValidMemory(item)) continue;
    const text = cleanText(item.text);
    if (!text) continue;
    out.push({ id: item.id, cwd: item.cwd, text, createdAt: item.createdAt, updatedAt: item.updatedAt });
    if (out.length >= limit) break;
  }
  return out;
}

export function loadProjectMemories(storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return [];
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeProjectMemories(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveProjectMemories(storage, memories) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(normalizeProjectMemories(memories)));
    return true;
  } catch {
    return false;
  }
}

export function listProjectMemories(memories, cwd) {
  const root = String(cwd || '');
  if (!root) return [];
  return normalizeProjectMemories(memories).filter((m) => m.cwd === root);
}

export function addProjectMemory(memories, cwd, text, now = Date.now()) {
  const clean = cleanText(text);
  const root = String(cwd || '');
  if (!clean || !root) return normalizeProjectMemories(memories);
  const list = normalizeProjectMemories(memories);
  const mine = list.filter((m) => m.cwd === root);
  if (mine.length >= MAX_PER_PROJECT) return list;
  const stamp = Number.isFinite(now) ? now : Date.now();
  return normalizeProjectMemories([
    { id: `pm-${stamp}-${Math.floor(Math.random() * 1e6)}`, cwd: root, text: clean, createdAt: stamp, updatedAt: stamp },
    ...list,
  ]);
}

export function deleteProjectMemory(memories, id) {
  return normalizeProjectMemories(memories).filter((m) => m.id !== id);
}

// Wire block: newest first, hard-capped so a large memory shelf cannot
// flood the context. Returns '' when there is nothing to inject.
export function formatMemoryContext(memories, cwd) {
  const mine = listProjectMemories(memories, cwd);
  if (mine.length === 0) return '';
  const lines = [];
  let used = 0;
  for (const m of mine) {
    const line = `- ${m.text.replace(/\n/g, ' ')}`;
    if (used + line.length + 1 > WIRE_CAP) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return `\n\n--- 프로젝트 기억 ---\n${lines.join('\n')}`;
}
