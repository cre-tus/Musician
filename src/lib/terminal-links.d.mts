export interface TerminalLink {
  /** 1-based column of the first character (xterm range). */
  start: number;
  /** 1-based column past the last character (xterm range). */
  end: number;
  url: string;
}
export function findTerminalLinks(line: string | null | undefined, limit?: number): TerminalLink[];
