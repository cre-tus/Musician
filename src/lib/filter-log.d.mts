export function filterLogLines(
  text: string | null | undefined,
  opts?: { query?: string; errorsOnly?: boolean } | null,
): string[];
