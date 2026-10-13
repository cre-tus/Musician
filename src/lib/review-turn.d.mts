export const REVIEW_THREAD_SUFFIX: string;
export const REVIEW_READONLY_SUFFIX: string;
export function reviewThreadKey(threadKey: unknown): string;
export function isReviewThreadKey(key: unknown): boolean;
export function matchesReviewThread(threadKey: unknown, sessionId: unknown): boolean;
export function buildReviewPrompt(files: unknown, lang?: string): string;
