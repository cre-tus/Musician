export type AgentBadgeMode = 'active' | 'off' | 'checking' | 'ok' | 'down';
export interface AgentBadgeState {
  mode: AgentBadgeMode;
  label: string;
  title: string;
  clickable: boolean;
}
export interface AgentBadgeHealth {
  ok: boolean;
  reason?: string | null;
}
export function reasonLabel(reason: string | null | undefined, lang?: 'ko' | 'en'): string;
export function agentBadgeState(input: {
  agentEnabled: boolean;
  health: AgentBadgeHealth | null;
  agentActive: boolean;
  method: string;
}, lang?: 'ko' | 'en'): AgentBadgeState;
