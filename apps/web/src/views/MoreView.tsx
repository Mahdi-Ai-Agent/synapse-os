import { CalendarRange, Target, ChevronLeft, ChevronRight, Inbox, Languages, Moon, Settings, Sun, UserRound } from 'lucide-react';
import type { TKey } from '../i18n';
import type { View } from '../lib/types';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { useStore } from '../state/store';

/** The phone's fifth tab: the plan, the inbox, "me", settings, the language and the theme. */
export function MoreView() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const setView = useStore((s) => s.setView);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const pages: Array<{ view: View; key: TKey; Icon: typeof Settings }> = [
    { view: 'goals', key: 'nav.goals', Icon: Target }, { view: 'plan', key: 'nav.plan', Icon: CalendarRange }, { view: 'inbox', key: 'nav.inbox', Icon: Inbox },
    { view: 'me', key: 'nav.me', Icon: UserRound }, { view: 'settings', key: 'nav.settings', Icon: Settings },
  ];
  const Chevron = locale === 'fa' ? ChevronLeft : ChevronRight;
  const switchLocale = (): void => {
    const next = locale === 'fa' ? 'en' : 'fa';
    setLocale(next);
    void api.putSettings({ locale: next }).catch(() => undefined);
  };
  return (
    <div className="view-body">
      <h1 className="view-title">{t('more.title')}</h1>
      <p className="view-sub">{t('more.hint')}</p>
      <ul className="card mt-4 divide-y divide-line p-0">
        {pages.map(({ view, key, Icon }) => (
          <li key={view}>
            <button onClick={() => setView(view)} className="flex w-full items-center gap-3 px-4 py-3.5 text-start text-sm hover:bg-panel2">
              <Icon size={18} className="text-muted" />
              <span className="flex-1">{t(key)}</span>
              <Chevron size={16} className="text-muted" />
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="flex w-full items-center gap-3 px-4 py-3.5 text-start text-sm hover:bg-panel2">
            {theme === 'light' ? <Moon size={18} className="text-muted" /> : <Sun size={18} className="text-muted" />}
            <span className="flex-1">{t(theme === 'light' ? 'nav.themeDark' : 'nav.themeLight')}</span>
          </button>
        </li>
        <li>
          <button onClick={switchLocale} className="flex w-full items-center gap-3 px-4 py-3.5 text-start text-sm hover:bg-panel2">
            <Languages size={18} className="text-muted" />
            <span className="flex-1">{t('nav.language')}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
