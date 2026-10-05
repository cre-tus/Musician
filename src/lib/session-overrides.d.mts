export const EFFORT_VALUES: string[];
export function sanitizeEffort(value: unknown): string;
export function sanitizeModel(value: unknown): string;
export interface ResolvedOverride {
  value: string;
  overridden: boolean;
}
export function resolveModel(session: unknown, settings: unknown): ResolvedOverride;
export function resolveEffort(session: unknown, settings: unknown): ResolvedOverride;
export function hasOverride(session: unknown): boolean;
export function sendOverrides(session: unknown): { model?: string; effort?: string };
