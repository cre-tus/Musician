export function saveFilesSequentially<T>(files: T[], saveFile: (file: T) => Promise<boolean | undefined>): Promise<{ saved: T[]; failed: T[] }>;
