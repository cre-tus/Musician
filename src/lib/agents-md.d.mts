export const AGENTS_MD_NAME: string;
export const AGENTS_MD_MAX: number;
export function agentsMdPath(cwd: unknown): string;
export function validateAgentsMd(content: unknown): { ok: boolean; error?: string };
