export interface RunningSessionRow {
  id: string;
  title: string;
  current: boolean;
}
export function visibleRunningSessions(
  sessions: unknown,
  runningIds: unknown,
  activeId: unknown,
): RunningSessionRow[];
