export interface TurnHook {
  event: 'turn-start' | 'turn-done';
  command: string;
  enabled: boolean;
  timeoutSec: number;
}
export const HOOK_EVENTS: string[];
export const HOOK_MAX: number;
export const HOOK_COMMAND_MAX: number;
export const HOOK_TIMEOUT_DEFAULT: number;
export const HOOK_TIMEOUT_MIN: number;
export const HOOK_TIMEOUT_MAX: number;
export function normalizeHookTimeout(v: unknown): number;
export function parseHooks(raw: unknown): TurnHook[];
export function validateHooks(list: unknown): { ok: boolean; error?: string; index?: number };
export function matchHooks(hooks: unknown, event: unknown): TurnHook[];
export function cleanHooks(list: unknown): TurnHook[];
