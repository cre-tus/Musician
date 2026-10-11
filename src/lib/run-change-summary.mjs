// Latest run-change summary for the strip above the composer. Derives from
// persisted session messages (last message carrying changedStats), so the
// strip survives reloads with no extra state.
// -> { messageId, cwd, files:[{file,added,deleted}], added, deleted } | null
export function latestChangeSummary(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object' || !Array.isArray(msg.changedStats) || msg.changedStats.length === 0) continue;
    const files = [];
    for (const row of msg.changedStats) {
      if (!row || typeof row !== 'object' || typeof row.file !== 'string' || !row.file) continue;
      const added = Number(row.added);
      const deleted = Number(row.deleted);
      files.push({
        file: row.file,
        added: Number.isFinite(added) && added > 0 ? Math.floor(added) : 0,
        deleted: Number.isFinite(deleted) && deleted > 0 ? Math.floor(deleted) : 0,
      });
    }
    if (files.length === 0) continue;
    return {
      messageId: typeof msg.id === 'string' ? msg.id : '',
      cwd: typeof msg.cwd === 'string' ? msg.cwd : '',
      files,
      added: files.reduce((n, f) => n + f.added, 0),
      deleted: files.reduce((n, f) => n + f.deleted, 0),
    };
  }
  return null;
}
