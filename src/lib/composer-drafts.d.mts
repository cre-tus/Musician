export declare const ATTACH_DRAFT_MAX: number;
export interface AttachDescriptor {
  path: string;
  name: string;
  image: boolean;
  folder: boolean;
}
export declare function attachDraftKey(sessionId: string | null | undefined): string;
export declare function saveAttachDraft(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  sessionId: string | null | undefined,
  list: unknown,
): boolean;
export declare function loadAttachDraft(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  sessionId: string | null | undefined,
): { kept: AttachDescriptor[]; droppedImages: boolean };
export declare function clearAttachDraft(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
  sessionId: string | null | undefined,
): void;
export declare function isOutsideDir(
  absPath: string | null | undefined,
  dir: string | null | undefined,
): boolean;
