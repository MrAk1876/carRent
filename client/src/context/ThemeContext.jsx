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

const resolveInitialTheme = () => {
  if (!canUseDom()) return THEME.LIGHT;
  const savedTheme = String(window.localStorage.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
  if (savedTheme === THEME.DARK || savedTheme === THEME.LIGHT) return savedTheme;
  // Always start in light mode until user chooses otherwise.
  return THEME.LIGHT;
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
