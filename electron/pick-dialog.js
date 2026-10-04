'use strict';
// Normalize native open-dialog results into the mudex:pick-* IPC contract.
// The OS dialog itself cannot be driven in E2E (no DOM, no CDP), so this
// pure normalizer carries the committed coverage for the picker path.
// Semantics mirror the legacy handlers exactly (including the files
// empty-but-ok passthrough, which the renderer guards by length).
function pickDialogResult(kind, res) {
  const cancelled = { ok: false, cancelled: true };
  if (!res || typeof res !== 'object') return cancelled;
  if (res.canceled) return cancelled;
  const paths = Array.isArray(res.filePaths) ? res.filePaths : [];
  if (kind === 'files') return { ok: true, paths };
  if (kind === 'folder') {
    if (paths.length === 0) return cancelled;
    return { ok: true, path: paths[0] };
  }
  return cancelled;
}

module.exports = { pickDialogResult };
