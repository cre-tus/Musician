import React, { createContext, useContext } from 'react';
import { STRINGS, sanitizeLang } from './i18n.mjs';
import type { Lang } from './i18n.mjs';

export const LangContext = createContext<Lang>('ko');

export function useLang(): Lang {
  return sanitizeLang(useContext(LangContext));
}

export function useStrings(): Record<string, Record<string, string>> {
  return STRINGS[sanitizeLang(useContext(LangContext))];
}
