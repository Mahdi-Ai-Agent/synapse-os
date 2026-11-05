import { LayoutGrid, MoreHorizontal, Palette, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useMemo, useState } from 'react';
import { INBOX_GROUP, JOURNAL_GROUP, UNSORTED_GROUP } from '../../graph/layout';
import { groupKey } from '../../graph/model';
import { useT, type TKey } from '../../i18n';
import { api } from '../../lib/api';
import { usePalette } from '../../lib/categories';
import { fmtNum } from '../../lib/format';
import type { UiGraphNode } from '../../lib/types';
import { useStore } from '../../state/store';
import { FoldedCards, KindCard } from '../../kinds/Cards';
import { InlineText } from '../../kinds/fields';
import { ARCHIVED, DONE, KIND_ORDER } from '../../kinds/meta';
import { ColorPopover } from '../ColorPicker';
import { TypeIcon } from '../TypeIcon';

const SPECIAL_TITLE: Record<string, TKey> = { [INBOX_GROUP]: 'group.inbox', [JOURNAL_GROUP]: 'group.journal', [UNSORTED_GROUP]: 'group.unsorted' };
const PER_KIND = 4;

/**
 * The card a category opens on the map, like a place on a map (spec: docs/UI-DESIGN.md "Mind map"): its name and
 * line (both edit in place), what it holds by kind as the kinds' own cards, and the ways to add or see everything.
 */
export function CategoryCard({ group, onClose }: { group: string; onClose: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const openDialog = useStore((s) => s.openDialog);
  const setView = useStore((s) => s.setView);
  const setCategoryPage = useStore((s) => s.setCategoryPage);
  const setToast = useStore((s) => s.setToast);
  const palette = usePalette();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const cat = palette.category(group);
  const special = SPECIAL_TITLE[group];
  const color = palette.group(group);

  const { byKind, done, gone, total } = useMemo(() => {
    const members = (graph?.nodes ?? []).filter((n) => groupKey(n) === group && n.id !== group);
    const live = members.filter((n) => !DONE.has(n.status) && !ARCHIVED.has(n.status));
    const byKind: Array<[string, UiGraphNode[]]> = [];
    for (const k of KIND_ORDER) {
      const list = live.filter((n) => (n.ghost ? 'ghost' : n.type) === k).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
      if (list.length) byKind.push([k, list]);
    }
    return { byKind, done: members.filter((n) => DONE.has(n.status)), gone: members.filter((n) => ARCHIVED.has(n.status)), total: members.length };
  }, [graph, group]);
  const rename = async (field: 'title' | 'summary', v: string): Promise<void> => {
    if (!cat || !v.trim()) return;
    try { await api.updateNode(cat.id, { frontmatter: { [field]: field === 'summary' ? v.slice(0, 160) : v } }); } catch (e) { setToast((e as Error).message); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ '--cat': color } as React.CSSProperties}>
      <div className="place-hero">
        <div className="flex items-start gap-3">
          <span className="cat-orb mt-1" />
          <div className="min-w-0 flex-1">
            {cat ? (
              <>
                <InlineText value={cat.title} placeholder={t('category.namePh')} onSave={(v) => rename('title', v)} className="place-title" />
                <InlineText value={cat.summary === cat.title ? '' : cat.summary} placeholder={t('category.summaryPh')} multiline onSave={(v) => rename('summary', v)} className="item-summary mt-0.5" />
              </>
            ) : <h2 className="place-title px-1">{special ? t(special) : group}</h2>}
            <p className="mt-1.5 px-1 text-xs text-muted">{t('place.items').replace('{n}', fmtNum(total, locale))}</p>
          </div>
          {cat && (
            <ColorPopover id={cat.id} value={cat.color} hint={cat.map ? `${t('color.categoryHint')} ${t('color.followsIsland')}` : t('color.categoryHint')}>
              <button className="icon-btn small ghost" aria-label={t('color.change')} title={t('color.change')}><Palette size={16} /></button>
            </ColorPopover>
          )}
          {cat && (
            <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
              <DropdownMenu.Trigger asChild>
                <button className="icon-btn small ghost" aria-label={t('common.more')} title={t('common.more')}><MoreHorizontal size={16} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" sideOffset={6} align="end" collisionPadding={10}>
                  <DropdownMenu.Item className="menu-item" onSelect={() => openDialog({ kind: 'category', editId: cat.id })}><Pencil size={14} />{t('place.edit')}</DropdownMenu.Item>
                  <DropdownMenu.Separator className="menu-sep" />
                  <DropdownMenu.Item className="menu-item is-danger" onSelect={() => openDialog({ kind: 'deleteCategory', id: cat.id })}><Trash2 size={14} />{t('category.delete')}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <button onClick={onClose} className="icon-btn small ghost" aria-label={t('common.close')} title={t('common.close')}><X size={16} /></button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {cat && <button onClick={() => openDialog({ kind: 'add', category: cat.id })} className="btn-primary"><Plus size={15} />{t('place.add')}</button>}
          <button onClick={() => { setCategoryPage(cat ? cat.id : group); setView('categories'); }} className="btn-soft"><LayoutGrid size={14} />{t('place.seeAll')}</button>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {total === 0 && <p className="py-4 text-sm text-muted">{t('category.empty')}</p>}
        {byKind.map(([k, list]) => {
          const expanded = open.has(k);
          const shown = expanded ? list : list.slice(0, PER_KIND);
          return (
            <section key={k} className="mb-5">
              <h3 className="section-title flex items-center gap-1.5"><TypeIcon type={k} size={13} />{t(`kinds.${k}` as TKey)}<span className="font-normal opacity-60">{fmtNum(list.length, locale)}</span></h3>
              <div className="space-y-1.5">{shown.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
              {list.length > PER_KIND && !expanded && (
                <button onClick={() => setOpen(new Set([...open, k]))} className="mt-1.5 px-1 text-xs font-medium text-accent hover:underline">{t('place.moreOf').replace('{n}', fmtNum(list.length - PER_KIND, locale))}</button>
              )}
            </section>
          );
        })}
        <FoldedCards title={t('category.doneSection')} items={done} />
        <FoldedCards title={t('category.archivedSection')} items={gone} />
      </div>
    </div>
  );
}
