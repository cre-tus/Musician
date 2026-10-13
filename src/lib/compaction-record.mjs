// Compaction records: the serve host owns summarization, so the app only
// observes. Terminal `compaction` items seen in a turn stream are folded
// into read-only records (outcome/trigger/token deltas/summary verbatim).
// The summary text is engine-owned and never edited here — the viewer shows
// exactly what the host reported, including the no-op/failure reason.
function textOf(it) {
  for (const k of ['text', 'summary', 'fallbackText']) {
    const v = it?.[k];
    if (Array.isArray(v)) {
      const t = v.filter((x) => typeof x === 'string').join('\n').trim();
      if (t) return t;
    } else if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function foldCompactionItems(items) {
  const out = [];
  if (!items || typeof items.values !== 'function') return out;
  for (const it of items.values()) {
    if (!it || it.kind !== 'compaction') continue;
    if (it.status === 'inProgress') continue;
    out.push({
      id: typeof it.itemId === 'string' ? it.itemId : '',
      outcome: typeof it.outcome === 'string' && it.outcome ? it.outcome : 'unknown',
      trigger: typeof it.trigger === 'string' && it.trigger ? it.trigger : null,
      reason: typeof it.reason === 'string' && it.reason ? it.reason : null,
      strategyId: typeof it.strategyId === 'string' && it.strategyId ? it.strategyId : null,
      summarizedThrough: typeof it.summarizedThrough === 'string' && it.summarizedThrough ? it.summarizedThrough : null,
      tokensBefore: numOrNull(it.tokensBefore),
      tokensAfter: numOrNull(it.tokensAfter),
      summary: textOf(it).slice(0, 4000),
      recordedAt: typeof it.recordedAt === 'string' ? it.recordedAt : null,
      turnId: typeof it.turnId === 'string' ? it.turnId : null,
    });
  }
  return out;
}

// One-line status for chips and transcript blocks. Verbatim outcome, never
// reworded into a success claim: only `compacted` means tokens were folded.
export function summarizeCompaction(rec, lang) {
  if (!rec || typeof rec !== 'object') return '';
  const en = lang === 'en';
  const delta = rec.tokensBefore != null && rec.tokensAfter != null
    ? ` ${rec.tokensBefore.toLocaleString()} → ${rec.tokensAfter.toLocaleString()}`
    : '';
  const trig = rec.trigger ? (en ? ` · ${rec.trigger}` : ` · ${rec.trigger}`) : '';
  if (rec.outcome === 'compacted') return en ? `Compacted${delta}${trig}` : `압축됨${delta}${trig}`;
  if (rec.outcome === 'noop') {
    const why = rec.reason ? ` (${rec.reason})` : '';
    return en ? `No compaction${why}` : `압축 없음${why}`;
  }
  if (rec.outcome === 'failed' || rec.outcome === 'cancelled') {
    const why = rec.reason ? ` (${rec.reason})` : '';
    return en ? `Compaction ${rec.outcome}${why}` : `압축 ${rec.outcome === 'failed' ? '실패' : '취소'}${why}`;
  }
  return String(rec.outcome);
}
