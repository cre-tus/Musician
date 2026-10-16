export function normalizeChangedList(files: unknown): string[];
export function indexOfChangedFile(files: unknown, current: unknown): number;
export function clampChangedIndex(files: unknown, index: unknown): number;
export function stepChangedFile(
  files: unknown,
  index: unknown,
  direction: unknown,
): { index: number; file: string | null };
