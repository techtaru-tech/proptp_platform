import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'propto.theme';

/** index.html applies the saved theme before first paint; this reads it back and switches it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  const toggleTheme = useCallback(() => {
    const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode or blocked storage: the theme still applies for this visit.
    }
    setTheme(next);
  }, []);

  return { theme, toggleTheme };
}
