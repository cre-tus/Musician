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

// Nests flat { dir, files } groups into a directory tree so a child folder
// renders inside its parent: collapsing the parent hides the whole subtree.
// Root ('') stays a top-level leaf. Missing ancestors are synthesized as
// empty-file headers (e.g. 'pkg' for 'pkg/alpha' + 'pkg/beta') so siblings
// read under their parent instead of scattering top-level; a synthesized
// header with a single child is folded away so a lone deep group gains no
// empty level. Matching is on slash boundaries so 'src2' never nests under
// 'src'. Input order is kept, input objects are not mutated.
export function nestCommitGroups(groups) {
  if (!Array.isArray(groups)) return [];
  const nodes = [];
  const byDir = new Map();
  for (const group of groups) {
    if (!group || typeof group !== 'object' || typeof group.dir !== 'string') continue;
    const dir = group.dir.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (byDir.has(dir)) continue;
    const node = { dir, files: Array.isArray(group.files) ? group.files : [], children: [] };
    byDir.set(dir, node);
    nodes.push(node);
  }
  const implicit = new Set();
  const ancestorsOf = (dir) => {
    const out = [];
    let rest = dir;
    for (;;) {
      const slash = rest.lastIndexOf('/');
      if (slash <= 0) break;
      rest = rest.slice(0, slash);
      out.unshift(rest);
    }
    return out;
  };
  const roots = [];
  for (const node of nodes) {
    if (!node.dir) {
      roots.push(node);
      continue;
    }
    let holder = null;
    for (const ancestor of ancestorsOf(node.dir)) {
      let parent = byDir.get(ancestor);
      if (!parent) {
        parent = { dir: ancestor, files: [], children: [] };
        byDir.set(ancestor, parent);
        implicit.add(ancestor);
      }
      if (holder) {
        if (!holder.children.includes(parent)) holder.children.push(parent);
      } else if (!roots.includes(parent)) {
        roots.push(parent);
      }
      holder = parent;
    }
    if (holder) holder.children.push(node);
    else if (!roots.includes(node)) roots.push(node);
  }
  const foldSingles = (list) => {
    const out = [];
    for (const node of list) {
      node.children = foldSingles(node.children);
      if (implicit.has(node.dir) && node.children.length === 1) out.push(node.children[0]);
      else out.push(node);
    }
    return out;
  };
  return foldSingles(roots);
}

// Display label for a directory group header: the last segment only
// ('src/lib' -> 'lib') so nested trees don't repeat ancestor paths.
// The full path stays available for tooltips and accessible names.
export function commitDirShortName(dir) {
  const value = String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!value) return '';
  const slash = value.lastIndexOf('/');
  return slash < 0 ? value : value.slice(slash + 1);
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
