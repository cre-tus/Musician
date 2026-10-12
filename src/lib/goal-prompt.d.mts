export const GOAL_NOTES_CONTEXT_LIMIT: number;
export function activeLinkedGoal(store: unknown, sessionId: unknown): {
  id: string;
  title: string;
  notes: string;
  status: string;
  progress: number;
  sessionIds: string[];
} | null;
export function formatGoalContext(goal: unknown, lang: unknown): string;
export function applyGoalContext(prompt: string, goal: unknown, lang: unknown): string;
export function buildGoalKick(goal: unknown, lang: unknown): string;
