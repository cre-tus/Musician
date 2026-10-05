// Pure helpers for the commit dialog's directory-grouped view. Shared by
// the renderer and the small Node-based regression test.
export function commitParentDir(file) {
  const value = String(file || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return '';
  return value.slice(0, slash);
}

// Groups repo-relative paths by parent directory: root files first, then
// alphabetical dirs. Files keep their input order within a group.
export function groupCommitFiles(files) {
  if (!Array.isArray(files)) return [];
  const order = [];
  const byDir = new Map();
  for (const entry of files) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const dir = commitParentDir(entry);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
      order.push(dir);
    }
    byDir.get(dir).push(entry);
  }
  order.sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return -1;
    if (b === '') return 1;
    return a < b ? -1 : 1;
  });
  return order.map((dir) => ({ dir, files: byDir.get(dir) }));
}

// Toggle-all batches for one directory group in the changes list: when every
// eligible file is already staged the whole group unstages, otherwise the
// unstaged remainder stages (staged files stay staged).
export function partitionGroupStage(files, isStaged) {
  const empty = { stage: [], unstage: [] };
  if (!Array.isArray(files)) return empty;
  const staged = typeof isStaged === 'function' ? isStaged : () => false;
  const eligible = files.filter((f) => typeof f === 'string' && f.trim());
  if (eligible.length === 0) return empty;
  if (eligible.every((f) => staged(f))) return { stage: [], unstage: eligible };
  return { stage: eligible.filter((f) => !staged(f)), unstage: [] };
}

// Initial dialog checklist: an explicit group list stays within the changed
// set, otherwise the staged set wins when one exists, else everything.
export function commitInitialSelection(changedFiles, isStaged, onlyFiles) {
  const list = Array.isArray(changedFiles)
    ? changedFiles.filter((f) => typeof f === 'string' && f.trim())
    : [];
  if (Array.isArray(onlyFiles)) {
    const changed = new Set(list);
    return onlyFiles.filter((f) => typeof f === 'string' && changed.has(f));
  }
  const staged = typeof isStaged === 'function' ? isStaged : () => false;
  const picked = list.filter((f) => staged(f));
  return picked.length > 0 ? picked : list;
}

// Checkbox state for one directory group against the per-file selection.
export function commitGroupCheckState(files, selection) {
  if (!Array.isArray(files) || files.length === 0) return 'none';
  const picked = selection && typeof selection === 'object' ? selection : {};
  let checked = 0;
  for (const file of files) {
    if (picked[file]) checked++;
  }
  if (checked === 0) return 'none';
  return checked === files.length ? 'all' : 'some';
}
