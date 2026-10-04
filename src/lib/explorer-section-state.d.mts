export type ExplorerSection = 'open' | 'pinned' | 'recent' | 'changed';

export interface ExplorerSectionState {
  open: boolean;
  pinned: boolean;
  recent: boolean;
  changed: boolean;
}

export const EXPLORER_SECTIONS: ExplorerSection[];
export function explorerSectionStorageKey(folder: string): string;
export function readExplorerSectionState(folder: string, storage?: Storage): ExplorerSectionState;
export function writeExplorerSectionState(folder: string, state: ExplorerSectionState, storage?: Storage): boolean;
export function toggleExplorerSection(state: ExplorerSectionState, section: ExplorerSection): ExplorerSectionState;
