import { atom } from 'nanostores';

export type Theme = 'dark' | 'light';

export const kTheme = 'bolt_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export const DEFAULT_THEME = 'light';

// Keep the first client render identical to SSR. The persisted theme is
// restored by the root layout after hydration to avoid React #418 mismatches.
export const themeStore = atom<Theme>(DEFAULT_THEME);

export function toggleTheme() {
  const currentTheme = themeStore.get();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  themeStore.set(newTheme);

  localStorage.setItem(kTheme, newTheme);

  document.querySelector('html')?.setAttribute('data-theme', newTheme);
}
