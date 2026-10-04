export function normalizePinnedFilePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function pinnedFileStorageKey(folder) {
  return `mudex:pinned-files:v1:${normalizePinnedFilePath(folder)}`;
}

export function readPinnedFilePaths(folder, storage) {
  if (!folder) return [];
  try {
    const target = storage || globalThis.localStorage;
    const root = normalizePinnedFilePath(folder);
    const raw = JSON.parse(target?.getItem(pinnedFileStorageKey(folder)) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.filter((path) => {
      if (typeof path !== 'string') return false;
      const normalized = normalizePinnedFilePath(path);
      if (!normalized.startsWith(`${root}/`) || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }).slice(0, 100);
  } catch {
    return [];
  }
}

function matchesPath(path, targetPath, includeDescendants) {
  const candidate = normalizePinnedFilePath(path);
  const target = normalizePinnedFilePath(targetPath);
  return candidate === target || (includeDescendants && candidate.startsWith(`${target}/`));
}

export function renamePinnedFilePaths(paths, oldPath, newPath, isDirectory = false) {
  const renamed = paths.map((path) => {
    if (matchesPath(path, oldPath, false)) return newPath;
    if (isDirectory && matchesPath(path, oldPath, true)) return `${newPath}${path.slice(oldPath.length)}`;
    return path;
  });
  const seen = new Set();
  return renamed.filter((path) => {
    const key = normalizePinnedFilePath(path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function removePinnedFilePaths(paths, removedPath, isDirectory = false) {
  return paths.filter((path) => !matchesPath(path, removedPath, isDirectory));
}

export function pinnedFileParentDirectories(paths, root) {
  const parents = new Map();
  for (const filePath of paths) {
    const normalizedRoot = normalizePinnedFilePath(root);
    const normalizedFile = normalizePinnedFilePath(filePath);
    if (!normalizedFile.startsWith(`${normalizedRoot}/`)) continue;
    const directorySegments = normalizedFile.slice(normalizedRoot.length + 1).split('/').filter(Boolean).slice(0, -1);
    const separator = String(filePath).includes('\\') || String(root).includes('\\') ? '\\' : '/';
    let directory = root;
    parents.set(normalizedRoot, directory);
    for (const segment of directorySegments) {
      directory = `${directory.replace(/[\\/]+$/, '')}${separator}${segment}`;
      parents.set(normalizePinnedFilePath(directory), directory);
    }
  }
  return [...parents.values()];
}

export async function reconcilePinnedFilePaths(paths, root, listDirectory) {
  const normalizedRoot = normalizePinnedFilePath(root);
  const directoryCache = new Map();
  const list = async (directory) => {
    const key = normalizePinnedFilePath(directory);
    if (!directoryCache.has(key)) {
      directoryCache.set(key, Promise.resolve().then(() => listDirectory(directory)).catch(() => null));
    }
    return await directoryCache.get(key);
  };

  const results = await Promise.all(paths.map(async (filePath) => {
    const normalizedPath = normalizePinnedFilePath(filePath);
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return { filePath, exists: true };
    const segments = normalizedPath.slice(normalizedRoot.length + 1).split('/').filter(Boolean);
    let directory = root;
    for (let index = 0; index < segments.length; index++) {
      const response = await list(directory);
      if (!response?.ok || !Array.isArray(response.entries)) return { filePath, exists: true };
      const entry = response.entries.find((candidate) => normalizePinnedFilePath(candidate.name) === segments[index]);
      if (!entry) return { filePath, exists: false };
      if (index < segments.length - 1) {
        if (!entry.isDir) return { filePath, exists: false };
        directory = entry.path;
      }
    }
    return { filePath, exists: true };
  }));
  return results.filter((result) => result.exists).map((result) => result.filePath);
}
