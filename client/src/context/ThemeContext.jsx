import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'car_rent_theme';
const THEME_ANIMATION_CLASS = 'theme-animating';
const THEME_ANIMATION_DURATION_MS = 560;
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

const resolveToggleOrigin = (sourceEvent) => {
  if (!canUseDom()) return { x: 0, y: 0 };

  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const fallback = {
    x: Math.max(0, Math.round(viewportWidth * 0.5)),
    y: Math.max(0, Math.round(viewportHeight * 0.45)),
  };

  const target = sourceEvent?.currentTarget || sourceEvent?.target;
  if (target && typeof target.getBoundingClientRect === 'function') {
    const rect = target.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    return { x, y };
  }

  if (typeof sourceEvent?.clientX === 'number' && typeof sourceEvent?.clientY === 'number') {
    return { x: Math.round(sourceEvent.clientX), y: Math.round(sourceEvent.clientY) };
  }

  return fallback;
};

const runThemeTransitionEffect = ({ nextTheme, sourceEvent }) => {
  if (!canUseDom()) return () => {};

  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return () => {};

  const origin = resolveToggleOrigin(sourceEvent);
  const x = `${origin.x}px`;
  const y = `${origin.y}px`;

  root.style.setProperty('--theme-switch-x', x);
  root.style.setProperty('--theme-switch-y', y);
  root.classList.add(THEME_ANIMATION_CLASS);

  const overlay = document.createElement('span');
  overlay.className = 'theme-switch-overlay';
  overlay.dataset.theme = nextTheme;
  overlay.style.setProperty('--theme-switch-x', x);
  overlay.style.setProperty('--theme-switch-y', y);
  body.appendChild(overlay);

  window.requestAnimationFrame(() => {
    overlay.classList.add('is-active');
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    root.classList.remove(THEME_ANIMATION_CLASS);
    root.style.removeProperty('--theme-switch-x');
    root.style.removeProperty('--theme-switch-y');
    overlay.remove();
  };

  const timeoutId = window.setTimeout(cleanup, THEME_ANIMATION_DURATION_MS + 120);

  return () => {
    window.clearTimeout(timeoutId);
    cleanup();
  };
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(resolveInitialTheme);

  useEffect(() => {
    applyThemeClass(theme);
    if (!canUseDom()) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback((sourceEvent) => {
    const nextTheme = theme === THEME.DARK ? THEME.LIGHT : THEME.DARK;
    const cleanupTransition = runThemeTransitionEffect({ nextTheme, sourceEvent });
    setTheme(nextTheme);
    return cleanupTransition;
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === THEME.DARK,
      setTheme,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
