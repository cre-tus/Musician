export interface ToolRecord {
  id: string;
  kind: string;
  tool: string;
  target: string;
  status: string;
  durationMs: number | null;
  exitCode: number | null;
  error: string;
  output: string;
}
export const TOOL_HISTORY_CAP: number;
export function snapshotToolHistory(items: unknown, max?: number): ToolRecord[];
