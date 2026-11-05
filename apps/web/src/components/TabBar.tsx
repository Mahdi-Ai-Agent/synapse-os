import { Compass, Ellipsis, LayoutGrid, Map as MapIcon, MessageCircle } from 'lucide-react';
import { useT, type TKey } from '../i18n';
import type { View } from '../lib/types';
import { useStore } from '../state/store';

const tabs: Array<{ view: View; key: TKey; Icon: typeof MapIcon; covers: View[] }> = [
  { view: 'coach', key: 'tab.coach', Icon: Compass, covers: ['coach', 'today'] },
  { view: 'graph', key: 'tab.map', Icon: MapIcon, covers: ['graph'] },
  { view: 'chat', key: 'tab.chat', Icon: MessageCircle, covers: ['chat'] },
  { view: 'categories', key: 'tab.categories', Icon: LayoutGrid, covers: ['categories'] },
  { view: 'more', key: 'tab.more', Icon: Ellipsis, covers: ['more', 'settings', 'goals', 'plan', 'inbox', 'me'] },
];

/** Phone navigation (docs/UI-DESIGN.md "Phone layout"): the chat in the middle, like the composer of a messenger. */
export function TabBar() {
  const t = useT();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const inboxCount = useStore((s) => s.graph?.stats.byType['inbox'] ?? 0);

  return (
    <nav className="tabbar flex shrink-0 items-stretch border-t border-line bg-bg2/90 backdrop-blur-xl" aria-label={t('tab.more')}>
      {tabs.map(({ view: v, key, Icon, covers }) => {
        const active = covers.includes(view);
        const center = v === 'chat';
        return (
          <button key={v} onClick={() => setView(v)} aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'text-accent' : 'text-muted'}`}>
            {center ? (
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${active ? 'send-btn' : 'bg-panel2 text-text'}`}><Icon size={18} strokeWidth={2} /></span>
            ) : <Icon size={20} strokeWidth={1.75} />}
            {!center && <span>{t(key)}</span>}
            {v === 'coach' && inboxCount > 0 && <span className="absolute end-[calc(50%-18px)] top-1.5 h-2 w-2 rounded-full bg-warn" />}
          </button>
        );
      })}
    </nav>
  );
}
