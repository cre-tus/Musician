export function formatEditorSelectionPrompt(selection: {
  relativePath: string;
  startLine: number;
  endLine: number;
  language: string;
  text: string;
}, uiLang?: 'ko' | 'en'): string;
