export const STORAGE_KEY: string;
export const MAX_MEMORIES: number;
export const MAX_PER_PROJECT: number;
export const MAX_MEMORY_TEXT: number;
export const WIRE_CAP: number;
export interface ProjectMemory {
  id: string;
  cwd: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  disabled?: boolean;
}
export function normalizeProjectMemories(value: unknown, limit?: number): ProjectMemory[];
export function loadProjectMemories(storage?: unknown): ProjectMemory[];
export function saveProjectMemories(storage?: unknown, memories?: unknown): boolean;
export function listProjectMemories(memories: unknown, cwd: unknown): ProjectMemory[];
export function addProjectMemory(memories: unknown, cwd: unknown, text: unknown, now?: number): ProjectMemory[];
export function updateProjectMemory(memories: unknown, id: unknown, text: unknown, now?: number): ProjectMemory[];
export function setProjectMemoryEnabled(memories: unknown, id: unknown, enabled: unknown): ProjectMemory[];
export function deleteProjectMemory(memories: unknown, id: unknown): ProjectMemory[];
export function formatMemoryContext(memories: unknown, cwd: unknown): string;
