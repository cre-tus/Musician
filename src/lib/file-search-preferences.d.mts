export interface FileSearchPreferences {
  include: string;
  exclude: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  filtersOpen: boolean;
}
export function defaultFileSearchPreferences(): FileSearchPreferences;
export function fileSearchPreferencesKey(folder: string): string;
export function readFileSearchPreferences(folder: string, storage?: Storage): FileSearchPreferences;
export function writeFileSearchPreferences(folder: string, value: Partial<FileSearchPreferences>, storage?: Storage): boolean;
