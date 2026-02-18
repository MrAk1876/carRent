import React from 'react';
import { useTheme } from '../context/ThemeContext';

const ThemeToggle = ({ className = '', showLabel = true }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      onClick={toggleTheme}
      className={`theme-toggle inline-flex items-center gap-2 rounded-xl border border-borderColor bg-white/90 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-all hover:border-primary/40 hover:text-primary ${className}`}
    >
      <span className={`theme-toggle__icon ${isDark ? 'is-dark' : ''}`} aria-hidden="true">
        {isDark ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <circle cx="12" cy="12" r="4.4" />
            <path strokeLinecap="round" d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7.2 7.2 0 0 0 9.8 9.8Z" />
          </svg>
        )}
      </span>
      {showLabel && <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>}
      <span
        className={`theme-toggle__track relative h-5 w-9 rounded-full border border-slate-300 bg-slate-200 transition-all ${
          isDark ? 'bg-primary/80 border-primary/60' : ''
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all ${
            isDark ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
};

export default ThemeToggle;
