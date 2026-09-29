'use client';

import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

import {THEME_KEY} from '@/config/theme';
import {readString, writeString} from '@/lib/storage';

/**
 * Dark (default) and light metallic themes.
 *
 * The attribute is applied to <html> before first paint by the inline script in
 * the root layout so a light-theme user never sees a dark flash; this provider
 * then takes over and keeps the attribute and storage in sync.
 */
export type Theme = 'dark' | 'light';

type ThemeState = {theme: Theme; setTheme: (t: Theme) => void; toggle: () => void};

const Ctx = createContext<ThemeState | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = readString(THEME_KEY);
    const initial: Theme = stored === 'light' ? 'light' : 'dark';
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    writeString(THEME_KEY, t);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark')}),
    [theme, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
