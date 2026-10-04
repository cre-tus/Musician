export function normalizePathForComparison(value: string): string;
export function pathsEqual(left: string, right: string): boolean;
export function isSameOrDescendantPath(parentPath: string, candidatePath: string): boolean;
export function relativePathFromRoot(rootPath: string, filePath: string): string;
export function maskHomePath(value: unknown): string;
export function maskHomePathEverywhere(value: unknown): string;
