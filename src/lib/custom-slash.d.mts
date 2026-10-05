export interface CustomSlashCommand {
  name: string;
  template: string;
  desc: string;
}
export interface CustomSlashMatch {
  id: string;
  name: string;
  title: string;
  hint: string;
  keywords: string[];
  kind: 'custom';
  template: string;
}
export const CUSTOM_SLASH_KEY: string;
export const CUSTOM_SLASH_NAME_RE: RegExp;
export const CUSTOM_SLASH_MAX: number;
export const CUSTOM_SLASH_TEMPLATE_MAX: number;
export const CUSTOM_SLASH_DESC_MAX: number;
export function normalizeCustomSlashName(name: unknown): string;
export function isCustomSlashNameTaken(name: unknown, builtinIds?: Array<string | null | undefined>): boolean;
export function parseCustomSlashCommands(raw: unknown, builtinIds?: Array<string | null | undefined>): CustomSlashCommand[];
export function serializeCustomSlashCommands(list: unknown): string;
export function readCustomSlashCommands(storage: Pick<Storage, 'getItem'> | null | undefined, builtinIds?: Array<string | null | undefined>): CustomSlashCommand[];
export function writeCustomSlashCommands(storage: Pick<Storage, 'setItem'> | null | undefined, list: unknown, builtinIds?: Array<string | null | undefined>): { ok: boolean; error?: string };
export function expandCustomSlash(template: unknown, args: unknown): { text: string; cursor: number };
export function findCustomSlash(input: unknown, caret?: number, customs?: CustomSlashCommand[] | null): { name: string; args: string; template: string; desc: string } | null;
export function matchCustomSlashCommands(query: unknown, customs?: CustomSlashCommand[] | null, limit?: number): CustomSlashMatch[];
