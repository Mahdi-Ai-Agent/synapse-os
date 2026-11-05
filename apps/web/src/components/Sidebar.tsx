import { CalendarRange, Compass, Inbox, Languages, Target, UserRound, LayoutGrid, Map as MapIcon, MessageCircle, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Settings, Sun } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { newChat } from '../lib/brain';
import { fmtNum } from '../lib/format';
import type { View } from '../lib/types';
import { useStore } from '../state/store';
import { EngineDot } from './EnginePill';

const NAV: Array<{ view: View; key: TKey; Icon: typeof MapIcon }> = [
  { view: 'chat', key: 'nav.chat', Icon: MessageCircle },
  { view: 'graph', key: 'nav.map', Icon: MapIcon },
  { view: 'coach', key: 'nav.coach', Icon: Compass },
  { view: 'goals', key: 'nav.goals', Icon: Target },
  { view: 'plan', key: 'nav.plan', Icon: CalendarRange },
  { view: 'inbox', key: 'nav.inbox', Icon: Inbox },
  { view: 'me', key: 'nav.me', Icon: UserRound },
  { view: 'categories', key: 'nav.categories', Icon: LayoutGrid },
];

export const SIDEBAR_WIDTH = 256;
export const SIDEBAR_COLLAPSED = 68;

/**
 * The desktop sidebar on the start edge (right in Persian) (spec: docs/UI-DESIGN.md "Shell"): new chat, the pages,
 * then settings and the language switch. It folds to an icon column. Past chats live inside the chat page.
 */
export function Sidebar() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setLocale = useStore((s) => s.setLocale);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const setCollapsed = useStore((s) => s.setSidebarCollapsed);
  const inboxCount = useStore((s) => s.graph?.stats.byType['inbox'] ?? 0);
  const run = useStore((s) => s.run);
  const busy = run !== null && (run.status === 'running' || run.status === 'queued');
  const rtl = locale === 'fa';
  const FoldIcon = collapsed ? (rtl ? PanelRightOpen : PanelLeftOpen) : (rtl ? PanelRightClose : PanelLeftClose);

  const switchLocale = (): void => {
    const next = locale === 'fa' ? 'en' : 'fa';
    setLocale(next);
    void api.putSettings({ locale: next }).catch(() => undefined);
  };

  return (
    <nav className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} style={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH }} aria-label={t('app.title')}>
      <div className="sidebar-top">
        <button className="sidebar-brand" onClick={() => setView('chat')} title={t('app.title')}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          {!collapsed && <span className="font-display text-[17px] font-extrabold tracking-tight">{t('app.title')}</span>}
        </button>
        {!collapsed && <button onClick={() => setCollapsed(true)} className="icon-btn small ghost" aria-label={t('nav.collapse')} title={t('nav.collapse')}><FoldIcon size={17} /></button>}
      </div>
      {collapsed && <Tip label={t('nav.expand')}><button onClick={() => setCollapsed(false)} className="side-item"><FoldIcon size={18} /></button></Tip>}

      <Tip label={t('nav.newChat')} off={!collapsed}>
        <button onClick={newChat} className="side-new"><Plus size={17} />{!collapsed && <span>{t('nav.newChat')}</span>}</button>
      </Tip>

      <div className="mt-2 space-y-0.5">
        {NAV.map(({ view: v, key, Icon }) => (
          <Tip key={v} label={t(key)} off={!collapsed}>
            <button onClick={() => setView(v)} className={`side-item ${view === v ? 'is-active' : ''}`} aria-current={view === v ? 'page' : undefined}>
              <span className="relative">
                <Icon size={18} strokeWidth={1.8} />
                {v === 'chat' && busy && <span className="side-busy" />}
              </span>
              {!collapsed && <span className="flex-1 truncate">{t(key)}</span>}
              {v === 'inbox' && inboxCount > 0 && <span className={collapsed ? 'side-badge dot' : 'side-badge'}>{collapsed ? '' : fmtNum(inboxCount, locale)}</span>}
            </button>
          </Tip>
        ))}
      </div>

      <div className="flex-1" />

      <div className="sidebar-foot">
        <Tip label={t('nav.settings')} off={!collapsed}>
          <button onClick={() => setView('settings')} className={`side-item ${view === 'settings' ? 'is-active' : ''}`}>
            <span className="relative"><Settings size={18} strokeWidth={1.8} /><EngineDot /></span>
            {!collapsed && <span className="flex-1 truncate">{t('nav.settings')}</span>}
          </button>
        </Tip>
        <Tip label={t('nav.language')} off={!collapsed}>
          <button onClick={switchLocale} className="side-item"><Languages size={18} strokeWidth={1.8} />{!collapsed && <span className="flex-1 truncate">{t('nav.language')}</span>}</button>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="side-item" aria-label={t(theme === 'light' ? 'nav.themeDark' : 'nav.themeLight')} title={t(theme === 'light' ? 'nav.themeDark' : 'nav.themeLight')}>
            {theme === 'light' ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}{!collapsed && <span className="flex-1 truncate">{t(theme === 'light' ? 'nav.themeDark' : 'nav.themeLight')}</span>}
          </button>
        </Tip>
      </div>
    </nav>
  );
}

function Tip({ label, off = false, children }: { label: string; off?: boolean; children: ReactNode }) {
  const locale = useStore((s) => s.locale);
  if (off) return <>{children}</>;
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content side={locale === 'fa' ? 'left' : 'right'} sideOffset={8} className="tooltip">{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}
