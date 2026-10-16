export interface FileRefText {
  text: string;
}
export interface FileRefLink {
  file: string;
  line: number;
  col: number | null;
  text: string;
}
export type FileRefSegment = FileRefText | FileRefLink;
export declare function splitFileRefs(text: string | null | undefined): FileRefSegment[];
export declare function joinAbs(cwd: string | null | undefined, rel: string | null | undefined): string;
