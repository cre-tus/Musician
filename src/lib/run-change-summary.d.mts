export interface RunChangeFile {
  file: string;
  added: number;
  deleted: number;
}
export interface RunChangeSummary {
  messageId: string;
  cwd: string;
  files: RunChangeFile[];
  added: number;
  deleted: number;
}
export function latestChangeSummary(messages: Array<{ id?: string; cwd?: string; changedStats?: Array<{ file?: string; added?: number; deleted?: number } | null> }> | null | undefined): RunChangeSummary | null;
