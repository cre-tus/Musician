// Changed-files-only navigation: step through this task's changed files
// with previous/next (wrap-around), without touching the full tree.
export function normalizeChangedList(files) {
  if (!Array.isArray(files)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of files) {
    if (typeof entry !== 'string') continue;
    const file = entry.trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

export function indexOfChangedFile(files, current) {
  const list = normalizeChangedList(files);
  if (typeof current !== 'string') return -1;
  return list.indexOf(current.trim());
}

export function clampChangedIndex(files, index) {
  const list = normalizeChangedList(files);
  if (list.length === 0) return -1;
  if (!Number.isSafeInteger(index)) return 0;
  return Math.max(0, Math.min(list.length - 1, index));
}

export function stepChangedFile(files, index, direction) {
  const list = normalizeChangedList(files);
  if (list.length === 0) return { index: -1, file: null };
  const dir = direction < 0 ? -1 : 1;
  let base = Number.isSafeInteger(index) ? index : (dir > 0 ? -1 : 0);
  if (base < 0 || base >= list.length) base = dir > 0 ? -1 : 0;
  const next = (base + dir + list.length) % list.length;
  return { index: next, file: list[next] };
}
