export type Lang = 'ko' | 'en';
export const SUPPORTED_LANGS: Lang[];
export function sanitizeLang(value: unknown): Lang;
export function formatStr(template: string, vars?: Record<string, string | number | undefined | null>): string;
// Area -> key -> template. Loose by design: key parity across languages is
// enforced by i18n-test, not by the type system.
export const STRINGS: Record<Lang, Record<string, Record<string, string>>>;
