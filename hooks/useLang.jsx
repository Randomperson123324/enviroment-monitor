'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE } from '@/config/client';
import { LANGS, translate } from '@/config/i18n';

const LangContext = createContext(null);

/** Wraps the app so any component can read the language and translate strings. */
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('th');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE.lang);
    if (LANGS.includes(saved)) setLangState(saved);
  }, []);

  const setLang = useCallback((l) => {
    if (!LANGS.includes(l)) return;
    setLangState(l);
    localStorage.setItem(STORAGE.lang, l);
    document.documentElement.lang = l;
  }, []);

  const toggle = useCallback(
    () => setLang(lang === 'th' ? 'en' : 'th'),
    [lang, setLang]
  );

  const value = useMemo(
    () => ({ lang, setLang, toggle, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang, toggle]
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}
