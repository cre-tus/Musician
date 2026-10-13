export interface ContextSource {
  kind: 'attach' | 'mention' | 'section' | 'goal';
  label: string;
  messageId: string;
}
export function collectContextSources(messages: unknown, activeGoal?: unknown): ContextSource[];
