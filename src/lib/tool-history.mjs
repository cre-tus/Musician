// Durable tool history: the live activity map (`mspItemsRef`) is cleared at
// every turn end, so completed turns kept only one-line `work` strings with
// no arguments and no results. Snapshotting terminal tool records into the
// assistant message preserves full targets, status, timing, exit codes, and
// bounded output tails for later inspection.
import { OUTPUT_CAP, mspFullTarget, tailOutput } from './msp-acts.mjs';

export const TOOL_HISTORY_CAP = 50;

const TOOL_KINDS = new Set(['toolCall', 'userShell', 'subagent']);

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function snapshotToolHistory(items, max = TOOL_HISTORY_CAP) {
  const out = [];
  if (!items || typeof items.values !== 'function') return out;
  const cap = Math.max(1, Math.min(Number(max) || TOOL_HISTORY_CAP, TOOL_HISTORY_CAP));
  for (const it of items.values()) {
    if (out.length >= cap) break;
    if (!it || !TOOL_KINDS.has(it.kind)) continue;
    if (it.status === 'inProgress') continue;
    out.push({
      id: typeof it.itemId === 'string' ? it.itemId : '',
      kind: it.kind,
      tool: typeof it.tool === 'string' && it.tool ? it.tool : it.kind,
      target: String(mspFullTarget(it) || '').slice(0, 4000),
      status: typeof it.status === 'string' ? it.status : 'unknown',
      durationMs: numOrNull(it.durationMs),
      exitCode: numOrNull(it.exitCode),
      error: typeof it.failureReason === 'string' && it.failureReason
        ? it.failureReason
        : typeof it.message === 'string' && it.message ? it.message : '',
      output: tailOutput(it.visibleOutput, OUTPUT_CAP),
    });
  }
  return out;
}
