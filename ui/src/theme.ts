import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'agentdesk:theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref = read();

function apply() {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}
apply();

const notify = () => listeners.forEach((l) => l());
media.addEventListener('change', notify);

export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private mode */
  }
  apply();
  notify();
}

export const cycleTheme = () => setThemePref(pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system');

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useThemePref = () => useSyncExternalStore(subscribe, () => pref);

/** Effective dark mode (preference, or macOS appearance when set to "system") */
export const useIsDark = () => useSyncExternalStore(subscribe, () => (pref === 'system' ? media.matches : pref === 'dark'));
