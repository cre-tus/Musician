export interface CompactionRecord {
  id: string;
  outcome: string;
  trigger: string | null;
  reason: string | null;
  strategyId: string | null;
  summarizedThrough: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  summary: string;
  recordedAt: string | null;
  turnId: string | null;
}
export function foldCompactionItems(items: unknown): CompactionRecord[];
export function summarizeCompaction(rec: unknown, lang?: string): string;
