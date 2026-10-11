export const INTERRUPT_PARTIAL_TAIL: number;
export interface InterruptResumeEntry {
  prompt: string;
  partial: string;
}
export interface InterruptChain {
  pending: string | null;
  turnPrompt: string | null;
  stack: InterruptResumeEntry[];
}
export function emptyInterruptChain(): InterruptChain;
export function normalizeInterruptChain(chain: unknown): InterruptChain;
export function armInterruptChain(chain: unknown, text: string, turnPrompt: string): InterruptChain;
export function tailInterruptPartial(partial: unknown): string;
export interface InterruptPop {
  send: string | null;
  sendKind: 'question' | 'resume' | null;
  sendEntry: InterruptResumeEntry | null;
  isFinal: boolean;
  dropped: boolean;
  chain: InterruptChain;
}
export function popInterruptChain(chain: unknown, completedSuccessfully: boolean, partial: unknown): InterruptPop;
export function buildResumePrompt(original: unknown, partial: unknown, lang?: string, isFinal?: boolean): string;
export function flattenInterruptChain(chain: unknown, lang?: string): string[];
