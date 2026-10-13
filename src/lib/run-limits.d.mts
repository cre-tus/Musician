export interface RunLimits {
  maxTurnTokens: number;
  maxAutoRuns: number;
}
export function normalizeRunLimits(settings: unknown): RunLimits;
export function turnTokenTotal(usage: unknown): number;
export function tokenLimitHit(usage: unknown, limits: unknown): boolean;
export function autoRunAllowed(autoCount: unknown, limits: unknown): boolean;
