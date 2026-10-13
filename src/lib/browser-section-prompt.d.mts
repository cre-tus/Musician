export function formatBrowserSectionPrompt(section: {
  pageTitle: string;
  pageUrl: string;
  tagPath: string;
  text: string;
  linkUrl: string;
}, uiLang?: 'ko' | 'en'): string;
export function formatBrowserSectionAnnotation(section: {
  pageTitle: string;
  pageUrl: string;
  tagPath: string;
  text: string;
  linkUrl: string;
  question: string;
}, uiLang?: 'ko' | 'en'): string;
