export interface SessionContextSummary {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  total: number;
  turns: number;
  messages: number;
  observed: number;
}
export function summarizeSessionContext(messages: unknown): SessionContextSummary;
export function formatCompactTokens(n: unknown): string;
