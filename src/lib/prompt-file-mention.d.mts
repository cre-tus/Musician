export interface PromptFileMention { start: number; end: number; query: string }
export function findPromptFileMention(value: string, cursor: number): PromptFileMention | null;
export function insertPromptFileMention(value: string, mention: Pick<PromptFileMention, 'start' | 'end'>, relativePath: string): { value: string; cursor: number };
