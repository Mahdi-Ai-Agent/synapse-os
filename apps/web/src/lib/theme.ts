import { desktop } from './desktop';

/** Dark (the night sky) or light (paper); UI-DESIGN "Light theme". */
export type Theme = 'dark' | 'light';

export function storedTheme(): Theme {
  try { return JSON.parse(localStorage.getItem('synapse.theme') ?? '"dark"') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

/** Sets the page's theme (the CSS reads `data-theme`) and tells the Mac app, whose window and lock page follow. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef1f7' : '#03050b');
  desktop()?.setTheme?.(theme);
}
