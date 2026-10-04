export interface ShortcutKeyPart {
  type: 'keys' | 'sep';
  text: string;
}
export function splitShortcutKeys(value: string | null | undefined): ShortcutKeyPart[];
export function shortcutGroupId(index: number): string;
