export const MAX_QUEUED_PROMPTS: number;
export function normalizePromptQueue(value: unknown, limit?: number): string[];
export function enqueuePrompt(queue: unknown, prompt: string, limit?: number): string[];
export function removeQueuedPrompt(queue: unknown, index: number): string[];
export function extractQueuedPrompt(queue: unknown, index: number): { prompt: string | null; remaining: string[] };
export function moveQueuedPrompt(queue: unknown, index: number, direction: -1 | 1): string[];
export function takeNextPrompt(queue: unknown): { prompt: string | null; remaining: string[] };
export function shouldAutoRunQueuedPrompt(state: {
  wasRunning: boolean;
  completedSuccessfully: boolean;
  cancelled: boolean;
  queuePaused?: boolean;
  queueLength: number;
}): boolean;
