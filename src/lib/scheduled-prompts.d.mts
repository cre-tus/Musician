export type ScheduledPromptStatus = 'pending' | 'fired' | 'missed';
export type ScheduledRepeat = 'once' | 'daily' | 'weekly' | 'monthly';
export interface ScheduledPrompt {
  id: string;
  sessionId: string;
  text: string;
  fireAt: number;
  createdAt: number;
  status: ScheduledPromptStatus;
  repeat: ScheduledRepeat;
}
export const MAX_SCHEDULED_PROMPTS: number;
export const STALE_AFTER_MS: number;
export function normalizeScheduledPrompts(value: unknown, limit?: number): ScheduledPrompt[];
export function createScheduledPrompt(input: {
  sessionId?: unknown;
  text?: unknown;
  fireAt?: unknown;
  repeat?: unknown;
  now?: number;
} | null | undefined): ScheduledPrompt | null;
export function nextRepeatFireTime(fireAt: number, repeat: unknown, now?: number): number | null;
export function rollRepeatingPrompt(list: unknown, id: unknown, now?: number): ScheduledPrompt[];
export function formatRepeat(repeat: unknown): string;
export function addScheduledPrompt(list: unknown, item: unknown): ScheduledPrompt[];
export function cancelScheduledPrompt(list: unknown, id: unknown): ScheduledPrompt[];
export function rescheduleScheduledPrompt(
  list: unknown,
  id: unknown,
  patch: { text?: unknown; fireAt?: unknown; repeat?: unknown } | null | undefined,
  now?: number,
): ScheduledPrompt[];
export function markScheduledPrompt(list: unknown, id: unknown, status: unknown): ScheduledPrompt[];
export function dueScheduledPrompts(list: unknown, now?: number): ScheduledPrompt[];
export function fireableScheduledPrompt(
  list: unknown,
  id: unknown,
  sessions: unknown,
  firing: unknown,
): ScheduledPrompt | null;
export function staleScheduledPrompts(list: unknown, now?: number): ScheduledPrompt[];
export function formatScheduledFireTime(fireAt: number, now?: number): string;
export function readScheduledPrompts(storage?: {
  getItem(key: string): string | null;
} | null): ScheduledPrompt[];
export function writeScheduledPrompts(
  list: unknown,
  storage?: { setItem(key: string, value: string): void } | null,
): void;
