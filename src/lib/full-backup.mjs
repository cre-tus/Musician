import { BACKUP_MAX_BYTES, BACKUP_VERSION, createSessionBackup, parseSessionBackup } from './session-backup.mjs';
import { normalizeProjectMemories } from './project-memory.mjs';
import { parseCustomSlashCommands, serializeCustomSlashCommands } from './custom-slash.mjs';
import { normalizeScheduledPrompts } from './scheduled-prompts.mjs';
import { sanitizeVerifyCommands } from './verify-commands.mjs';

// Full-app backup: sessions plus settings, project memories, custom slash
// commands, scheduled prompts, and per-project verify commands. Each part
// round-trips through its own normalizer so a corrupt section never poisons
// the rest. Exit 0 = ALL PASS (see full-backup-test.mjs).
export const FULL_BACKUP_VERSION = 1;

const SETTINGS_KEYS = [
  'cliPath', 'model', 'extraArgs', 'workdir', 'timeoutMs', 'maxTurnTokens',
  'maxAutoRuns', 'theme', 'codeTheme', 'engine', 'approvalMode',
  'reasoningEffort', 'contributorMode', 'githubToken', 'browserAgent',
  'browserHome', 'backgroundNotifications', 'lang', 'hooks',
];

function cleanSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const k of SETTINGS_KEYS) {
    if (value[k] !== undefined) out[k] = value[k];
  }
  return out;
}

function cleanVerifyCommands(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [cwd, list] of Object.entries(value)) {
    if (typeof cwd !== 'string' || !cwd || cwd.length > 1000) continue;
    const clean = sanitizeVerifyCommands(list);
    if (clean.length > 0) out[cwd] = clean;
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

export function createFullBackup(parts, options = {}) {
  const src = parts && typeof parts === 'object' ? parts : {};
  const sessionsDoc = JSON.parse(createSessionBackup(src.sessions, options));
  return JSON.stringify({
    app: 'musician',
    kind: 'full-backup',
    version: FULL_BACKUP_VERSION,
    exportedAt: sessionsDoc.exportedAt,
    sessions: sessionsDoc.sessions,
    settings: cleanSettings(src.settings),
    memories: normalizeProjectMemories(src.memories),
    slashCommands: JSON.parse(serializeCustomSlashCommands(src.slashCommands)),
    schedules: normalizeScheduledPrompts(src.schedules),
    verifyCommands: cleanVerifyCommands(src.verifyCommands),
  });
}

export function parseFullBackup(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'EMPTY_FILE' };
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: 'TOO_LARGE' };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (!doc || typeof doc !== 'object' || doc.app !== 'musician' || doc.kind !== 'full-backup') {
    return { ok: false, error: 'NOT_BACKUP' };
  }
  if (doc.version !== FULL_BACKUP_VERSION) return { ok: false, error: 'UNSUPPORTED_VERSION' };
  const sessions = [];
  if (Array.isArray(doc.sessions) && doc.sessions.length > 0) {
    const inner = parseSessionBackup(JSON.stringify({
      app: 'musician', kind: 'session-backup', version: BACKUP_VERSION,
      exportedAt: doc.exportedAt, sessions: doc.sessions,
    }));
    if (!inner.ok) return inner;
    sessions.push(...inner.sessions);
  }
  return {
    ok: true,
    data: {
      sessions,
      settings: cleanSettings(doc.settings),
      memories: normalizeProjectMemories(doc.memories),
      slashCommands: parseCustomSlashCommands(JSON.stringify(Array.isArray(doc.slashCommands) ? doc.slashCommands : []), []),
      schedules: normalizeScheduledPrompts(doc.schedules),
      verifyCommands: cleanVerifyCommands(doc.verifyCommands),
    },
  };
}
