// Project instructions editor: the single AGENTS.md at the project root.
// Resolution is deliberately narrow — root only, no ancestor hunt — so the
// UI can always name the exact file in scope. Writes go through the guarded
// write-file IPC (expectedOriginal) so outside edits surface as conflicts
// instead of silent overwrites.
export const AGENTS_MD_NAME = 'AGENTS.md';
export const AGENTS_MD_MAX = 100 * 1024;

export function agentsMdPath(cwd) {
  const root = String(cwd || '').trim();
  if (!root) return '';
  const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/';
  return `${root}${sep}${AGENTS_MD_NAME}`;
}

export function validateAgentsMd(content) {
  if (typeof content !== 'string') return { ok: false, error: 'BAD_CONTENT' };
  let bytes = content.length;
  try {
    bytes = new TextEncoder().encode(content).length;
  } catch {
    bytes = content.length * 3;
  }
  if (bytes > AGENTS_MD_MAX) return { ok: false, error: 'TOO_LARGE' };
  return { ok: true };
}
