export const RESUME_TAIL_CAP: number;
export const RESUME_TOOL_CAP: number;
export function formatResumeContext(message: unknown, request: unknown, lang?: string): string;
export function buildExactResumePrompt(
  message: unknown,
  request: unknown,
  opts?: { lang?: string; engineSession?: boolean },
): string;
