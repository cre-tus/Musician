export const COMPLETION_MET: string;
export const COMPLETION_OPEN: string;
export const COMPLETION_FAILED: string;
export interface CompletionVerdict {
  state: 'met' | 'open' | 'failed';
  reasons: string[];
}
export function judgeCompletion(args?: {
  goal?: unknown;
  verify?: unknown;
  todos?: unknown;
  tools?: unknown;
  timedOut?: unknown;
  error?: unknown;
  cancelled?: unknown;
  tokenLimit?: unknown;
}): CompletionVerdict;
export function completionVerdictLabel(record: CompletionVerdict | null | undefined, labels?: {
  state?: { met?: string; open?: string; failed?: string };
  reasons?: Record<string, string>;
}): string;
