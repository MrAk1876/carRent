import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'car_rent_theme';
const THEME = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
});

const ThemeContext = createContext({
  theme: THEME.LIGHT,
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

const canUseDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const resolveSystemTheme = () => {
  if (!canUseDom() || typeof window.matchMedia !== 'function') return THEME.LIGHT;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME.DARK : THEME.LIGHT;
};

const resolveInitialTheme = () => {
  if (!canUseDom()) return THEME.LIGHT;
  const savedTheme = String(window.localStorage.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
  if (savedTheme === THEME.DARK || savedTheme === THEME.LIGHT) return savedTheme;
  return resolveSystemTheme();
};

const applyThemeClass = (theme) => {
  if (!canUseDom()) return;
  const root = document.documentElement;
  const nextTheme = theme === THEME.DARK ? THEME.DARK : THEME.LIGHT;
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(nextTheme === THEME.DARK ? 'theme-dark' : 'theme-light');
  root.setAttribute('data-theme', nextTheme);
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(resolveInitialTheme);

  useEffect(() => {
    applyThemeClass(theme);
    if (!canUseDom()) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!canUseDom() || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const savedTheme = String(window.localStorage.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
      if (savedTheme === THEME.DARK || savedTheme === THEME.LIGHT) return;
      setTheme(media.matches ? THEME.DARK : THEME.LIGHT);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === THEME.DARK,
      setTheme,
      toggleTheme: () => setTheme((prev) => (prev === THEME.DARK ? THEME.LIGHT : THEME.DARK)),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);

export { THEME };
