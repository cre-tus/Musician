export interface CommitFileGroup {
  dir: string;
  files: string[];
}

export function commitParentDir(file: string): string;

export function groupCommitFiles(files: string[]): CommitFileGroup[];

export function partitionGroupStage(
  files: string[],
  isStaged: (file: string) => boolean,
): { stage: string[]; unstage: string[] };

export function commitInitialSelection(
  changedFiles: string[],
  isStaged: (file: string) => boolean,
  onlyFiles?: string[],
): string[];

export function commitGroupCheckState(
  files: string[],
  selection: Record<string, boolean>,
): 'all' | 'some' | 'none';
