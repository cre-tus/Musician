export function normalizePathForComparison(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function pathsEqual(left, right) {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

export function isSameOrDescendantPath(parentPath, candidatePath) {
  const parent = normalizePathForComparison(parentPath);
  const candidate = normalizePathForComparison(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export function maskHomePath(value) {
  const text = String(value || '');
  if (!text) return text;
  // Hide the local user-profile prefix on screen (e.g. C:\Users\<name>\...)
  // so distributed screenshots and recordings never leak account names.
  // Copy/registration flows keep the real value; only display is masked.
  const win = text.match(/^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+(?=[\\/]|$)/);
  if (win) return `~${text.slice(win[0].length)}`.replace(/\\/g, '/');
  const posix = text.match(/^\/(home|Users)\/[^/]+(?=\/|$)/);
  if (posix) return `~${text.slice(posix[0].length)}`;
  return text;
}

export function maskHomePathEverywhere(value) {
  const text = String(value || '');
  if (!text) return text;
  // Same redaction for multi-line blobs (JSON settings blocks, command
  // lines) where the home prefix appears mid-string, possibly JSON-escaped.
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/"'\s]+/g, '~')
    .replace(/\/(home|Users)\/[^/"'\s]+/g, '~');
}

export function baseName(filePath) {
  const s = String(filePath == null ? '' : filePath).replace(/[\\/]+$/, '');
  if (!s) return '';
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i < 0 ? s : s.slice(i + 1);
}

export function relativePathFromRoot(rootPath, filePath) {
  const root = String(rootPath || '').replace(/[\\/]+$/, '');
  const file = String(filePath || '');
  const normalizedRoot = normalizePathForComparison(root);
  const normalizedFile = normalizePathForComparison(file);
  if (!normalizedRoot) return file.replace(/\\/g, '/');
  if (normalizedFile === normalizedRoot) return '';
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return file.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1);
  }
  return file.replace(/\\/g, '/');
}
