export interface MspActDetail {
  full: string;
  output: string;
  error: string;
  durationMs: number | null;
  exitCode: number | null;
}
export interface MspAct {
  key: string;
  tool: string;
  toolLabel: string;
  target: string;
  statusLabel: string;
  live: boolean;
  detail: MspActDetail | null;
  file: string | null;
}
export const OUTPUT_CAP: number;
export function mspTarget(it: unknown): string;
export function mspFullTarget(it: unknown): string;
export function mspFilePath(it: unknown): string;
export function tailOutput(s: unknown, cap?: number): string;
export function foldMspActs(items: unknown, lang?: string): MspAct[];
