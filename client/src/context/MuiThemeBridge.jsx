import React, { useMemo } from 'react';
import { CssBaseline, ThemeProvider as MuiThemeProvider, alpha, createTheme } from '@mui/material';
import { useTheme as useAppTheme } from './ThemeContext.jsx';

const MuiThemeBridge = ({ children }) => {
  const { isDark } = useAppTheme();

  const muiTheme = useMemo(() => {
    const mode = isDark ? 'dark' : 'light';
    const palette = {
      mode,
      primary: { main: '#2563eb' },
      secondary: { main: '#0ea5e9' },
      background: isDark
        ? { default: '#0b1220', paper: '#0f172a' }
        : { default: '#f8fafc', paper: '#ffffff' },
      text: isDark
        ? { primary: '#e2e8f0', secondary: '#94a3b8' }
        : { primary: '#0f172a', secondary: '#475569' },
      divider: isDark ? '#4b5d78' : '#cbd5e1',
    };

    return createTheme({
      palette,
      shape: {
        borderRadius: 10,
      },
      typography: {
        fontFamily: '"Outfit", sans-serif',
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ':root': {
              colorScheme: mode,
            },
            body: {
              backgroundColor: palette.background.default,
              color: palette.text.primary,
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              border: `1px solid ${alpha(palette.divider, isDark ? 0.55 : 0.8)}`,
              backgroundImage: 'none',
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 10,
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(palette.divider, isDark ? 0.75 : 1),
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(palette.primary.main, isDark ? 0.75 : 0.65),
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: palette.primary.main,
                borderWidth: 1.5,
              },
            },
            input: {
              color: palette.text.primary,
            },
          },
        },
        MuiInputLabel: {
          styleOverrides: {
            root: {
              color: palette.text.secondary,
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: 16,
              border: `1px solid ${alpha(palette.divider, isDark ? 0.6 : 0.75)}`,
              boxShadow: isDark
                ? '0 24px 60px rgba(2, 6, 23, 0.65)'
                : '0 24px 60px rgba(15, 23, 42, 0.18)',
            },
          },
        },
      },
    });
  }, [isDark]);

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  );
};

export default MuiThemeBridge;
