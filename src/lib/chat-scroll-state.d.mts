export interface ChatScrollState {
  scrollTop: number;
  follow: boolean;
}
export function parseChatScrollState(serialized: string): ChatScrollState | null;
export function clampChatScrollTop(state: ChatScrollState | null, maxScrollTop: number): number;
