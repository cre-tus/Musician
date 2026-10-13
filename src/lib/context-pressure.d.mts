export interface ContextPressureSummary {
  used: number;
  window: number;
  pct: number;
  remaining: number;
  pressure: string | null;
  sessionId: string | null;
}
export function summarizeContextPressure(p: unknown): ContextPressureSummary | null;
export function formatPressurePct(pct: unknown): string;
