export interface SlashCommand {
  id: 'new' | 'model' | 'usage' | 'settings' | 'shortcuts' | 'schedule' | 'export' | 'diff' | 'terminal';
  name: string;
  title: string;
  hint: string;
  keywords: string[];
}
export const SLASH_COMMANDS: SlashCommand[];
export function getSlashCommands(lang?: 'ko' | 'en'): SlashCommand[];
export function findSlashCommand(input: string | null | undefined, caret?: number): { query: string } | null;
export function matchSlashCommands(query: string | null | undefined, limit?: number, lang?: 'ko' | 'en'): SlashCommand[];
