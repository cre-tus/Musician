export interface McpChatHealthEntry {
  name: string;
  ok: boolean;
  reason: string | null;
}
export function mcpChatNotice(mcpHealth: McpChatHealthEntry[] | null | undefined, lang?: 'ko' | 'en'): string | null;
