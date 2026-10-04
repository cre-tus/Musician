export interface TextMatchRange { start: number; end: number }
export function findTextMatchRanges(text: string, query: string, caseSensitive?: boolean, wholeWord?: boolean): TextMatchRange[];
