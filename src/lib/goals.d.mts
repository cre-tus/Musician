export type GoalStatus = 'active' | 'done';
export interface Goal {
  id: string;
  title: string;
  notes: string;
  status: GoalStatus;
  progress: number;
  sessionIds: string[];
  createdAt: number;
  updatedAt: number;
}
export interface GoalSummary {
  total: number;
  active: number;
  done: number;
  avgProgress: number;
}
export const MAX_GOALS: number;
export const MAX_GOAL_TITLE: number;
export const MAX_GOAL_NOTES: number;
export const MAX_GOAL_LINKS: number;
export function normalizeGoals(value: unknown, limit?: number): Goal[];
export function createGoal(input: {
  title?: unknown;
  notes?: unknown;
  now?: number;
} | null | undefined): Goal | null;
export function addGoal(list: unknown, item: unknown): Goal[];
export function removeGoal(list: unknown, id: unknown): Goal[];
export function updateGoal(
  list: unknown,
  id: unknown,
  patch: { title?: unknown; notes?: unknown } | null | undefined,
  now?: number,
): Goal[];
export function setGoalProgress(list: unknown, id: unknown, progress: unknown, now?: number): Goal[];
export function bumpGoalProgress(list: unknown, id: unknown, delta: unknown, now?: number): Goal[];
export function toggleGoalDone(list: unknown, id: unknown, now?: number): Goal[];
export function linkGoalSession(list: unknown, id: unknown, sessionId: unknown, now?: number): Goal[];
export function unlinkGoalSession(list: unknown, id: unknown, sessionId: unknown, now?: number): Goal[];
export function pruneGoalSessions(list: unknown, liveIds: unknown): Goal[];
export function summarizeGoals(list: unknown): GoalSummary;
export interface GoalStore {
  goals: Goal[];
  activeGoalId: string | null;
}
export function normalizeGoalStore(value: unknown): GoalStore;
export function startGoal(store: unknown, id: unknown): GoalStore;
export function startGoalInSession(store: unknown, id: unknown, sessionId: unknown, now?: number): GoalStore;
export function stopGoal(store: unknown): GoalStore;
export function activeGoal(store: unknown): Goal | null;
export function readGoalStore(storage?: {
  getItem(key: string): string | null;
} | null): GoalStore;
export function writeGoalStore(
  store: unknown,
  storage?: { setItem(key: string, value: string): void } | null,
): void;
