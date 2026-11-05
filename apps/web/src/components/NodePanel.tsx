import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Link2, Map as MapIcon, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onBeforeLock } from '../lib/desktop';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format';
import { timelineOf } from '../lib/history';
import { withRelatedLink } from '../lib/markdown';
import type { NodeDetail, RelatedHit, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { KindBlock, KindFacts } from '../kinds/Detail';
import { InlineText } from '../kinds/fields';
import { ADDABLE_KINDS, ARCHIVABLE_KINDS, ARCHIVED, KIND_ORDER, STATUS_OPTIONS } from '../kinds/meta';
import { startRun } from '../lib/brain';
import { useMaps } from '../lib/maps';
import { ChipInput, plainTitle } from './ChipInput';
import { ColorPopover } from './ColorPicker';
import { SymbolPicker } from './Dialogs';
import { MapConnections } from './graph/MapsPanel';
import { Markdown } from './Markdown';
import { TypeIcon } from './TypeIcon';

/** TipTap is large; it loads the first time the details are edited. */
const BodyEditor = lazy(() => import('./BodyEditor').then((m) => ({ default: m.BodyEditor })));

function normalize(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * One item (spec: docs/UI-DESIGN.md "Item details"): first what it is — the kind badge, the category, the state and
 * the kind's facts as chips in one row — then one card that holds the title, the one-line summary, the details
 * (Markdown, edited on demand) and the item's history; then the kind's own block, what it is connected to, and
 * everything technical under "More". Used on the map, beside a page, and as a phone sheet.
 */
export function NodePanel({ sheet = false, onBack, onClose }: { sheet?: boolean; onBack?: () => void; onClose?: () => void } = {}) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const view = useStore((s) => s.view);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const graph = useStore((s) => s.graph);
  const setView = useStore((s) => s.setView);
  const setToast = useStore((s) => s.setToast);
  const requestFly = useStore((s) => s.requestFly);
  const openDialog = useStore((s) => s.openDialog);
  const palette = usePalette();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [related, setRelated] = useState<RelatedHit[]>([]);
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  // An item's text being edited is saved before the Mac app locks (the lock page replaces this page).
  const saveBodyRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => onBeforeLock(async () => { await saveBodyRef.current?.(); }), []);
  const [error, setError] = useState<string | null>(null);

  const gnode: UiGraphNode | undefined = useMemo(() => graph?.nodes.find((n) => n.id === selectedId), [graph, selectedId]);
  const ghost = gnode?.ghost ? gnode : null;

  useEffect(() => {
    setEditing(false);
    setError(null);
    if (!selectedId || selectedId.startsWith('ghost:')) { setDetail(null); setRelated([]); return; }
    let alive = true;
    api.node(selectedId).then((d) => { if (alive) setDetail(d); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || selectedId.startsWith('ghost:') || editing) return;
    api.node(selectedId).then(setDetail).catch(() => undefined);
  }, [graph?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRelated = useCallback((id: string): void => { api.related(id, 5).then((r) => setRelated(r.related)).catch(() => setRelated([])); }, []);
  const detailId = detail?.node.fm.id;
  const detailUpdated = detail?.node.fm.updated;
  useEffect(() => { if (detailId) loadRelated(detailId); }, [detailId, detailUpdated, loadRelated]);

  const byTitle = useMemo(() => {
    const m = new Map<string, UiGraphNode>();
    for (const n of graph?.nodes ?? []) if (!n.ghost) m.set(normalize(n.title), n);
    return m;
  }, [graph]);
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const personTitles = useMemo(() => (graph?.nodes ?? []).filter((n) => n.type === 'person').map((n) => n.title), [graph]);

  if (!selectedId) return null;
  const fm = detail?.node.fm;
  const type = fm?.type ?? (ghost ? 'ghost' : gnode?.type ?? 'note');
  const color = palette.node(gnode);
  const categoryColor = palette.group(gnode?.category ?? null);
  const resolve = (title: string): string | null => {
    const hit = detail?.outgoing.find((o) => normalize(o.text) === normalize(title) && o.resolved);
    return hit?.target ?? byTitle.get(normalize(plainTitle(title)))?.id ?? null;
  };

  const patch = async (frontmatter: Record<string, unknown>): Promise<void> => {
    if (!detail) return;
    try { setDetail(await api.updateNode(detail.node.fm.id, { frontmatter })); setError(null); } catch (e) { setError((e as Error).message); }
  };
  const saveBody = async (): Promise<void> => {
    if (!detail) return;
    try { setDetail(await api.updateNode(detail.node.fm.id, { body: bodyDraft })); setEditing(false); } catch (e) { setError((e as Error).message); }
  };
  saveBodyRef.current = editing && detail && bodyDraft !== detail.node.body ? saveBody : null;
  const materialize = async (): Promise<void> => {
    if (!ghost) return;
    try { const d = await api.createNode({ type: 'note', title: ghost.title, summary: ghost.title, source: 'manual' }); select(d.node.fm.id); } catch (e) { setToast((e as Error).message); }
  };
  const linkRelated = async (hit: RelatedHit): Promise<void> => {
    if (!detail) return;
    try { setDetail(await api.updateNode(detail.node.fm.id, { body: withRelatedLink(detail.node.body, hit.title) })); setToast(t('panel.linked')); } catch (e) { setError((e as Error).message); }
  };
  const dismissRelated = async (hit: RelatedHit): Promise<void> => {
    if (!detail) return;
    try { await api.dismissRelated(detail.node.fm.id, hit.id); setRelated((list) => list.filter((h) => h.id !== hit.id)); } catch (e) { setError((e as Error).message); }
  };
  const showOnMap = (): void => {
    const id = selectedId;
    if (view !== 'graph') setView('graph');
    select(id);
    requestFly([id]);
  };
  const close = (): void => { if (onClose) onClose(); else select(null); };
  const Back = locale === 'fa' ? ArrowRight : ArrowLeft;
  const archived = ARCHIVED.has(fm?.status ?? '');
  // Kinds with a state chip archive from it; the others archive from the menu.
  const archiveFromMenu = Boolean(fm) && !STATUS_OPTIONS[type] && ARCHIVABLE_KINDS.has(type);
  const canRetype = Boolean(fm) && (ADDABLE_KINDS as readonly string[]).includes(type);
  const hasCategory = Boolean(fm) && type !== 'area' && type !== 'journal' && type !== 'inbox' && type !== 'map';
  const history = detail ? timelineOf(detail.node.fm, detail.node.body, { created: t('panel.createdOn'), finished: t(type === 'goal' ? 'panel.reachedOn' : 'panel.finishedOn') }) : null;

  // What the kind view already shows is left out of "Connected to".
  const shownElsewhere = new Set<string>([gnode?.category ?? '']);
  const connected = new Map<string, { id: string; title: string; node?: UiGraphNode; note: string; faded: boolean }>();
  for (const b of detail?.backlinks ?? []) {
    const n = byId.get(b.id);
    if (type === 'project' && n?.type === 'task') continue;
    if (type === 'person' && n?.type === 'event') continue;
    if (type === 'goal' && (n?.type === 'project' || n?.type === 'habit' || n?.type === 'task')) continue;
    connected.set(b.id, { id: b.id, title: b.title, node: n, note: '', faded: false });
  }
  for (const o of detail?.outgoing ?? []) {
    const n = byId.get(o.target);
    if (type === 'event' && n?.type === 'person') continue;
    if (type === 'goal' && (n?.type === 'project' || n?.type === 'habit' || n?.type === 'task')) continue;
    if (!connected.has(o.target)) connected.set(o.target, { id: o.target, title: o.title ?? o.text, node: n, note: o.kind === 'link' ? '' : t(`edge.${o.kind}` as TKey), faded: !o.resolved });
  }
  for (const id of shownElsewhere) connected.delete(id);

  return (
    <div className={sheet ? 'safe-top item-sheet fade-in fixed inset-0 z-40 flex flex-col overflow-hidden' : 'flex h-full flex-col overflow-hidden'} style={{ '--node': color, '--cat': categoryColor } as React.CSSProperties}>
      <div className={`item-hero ${archived ? 'is-archived' : ''}`}>
        <div className="item-bar">
          {(onBack || sheet) && <button onClick={() => (onBack ? onBack() : close())} className="icon-btn small ghost" aria-label={t('common.back')} title={t('common.back')}><Back size={16} /></button>}
          <div className="flex-1" />
          {fm && (
            <ItemMenu
              onMap={view === 'graph' ? undefined : showOnMap}
              onEdit={() => { setBodyDraft(detail?.node.body ?? ''); setEditing(true); }}
              onCopy={() => void navigator.clipboard.writeText(fm.title)}
              onArchive={archiveFromMenu ? () => void patch({ status: archived ? 'active' : 'archived' }) : undefined}
              archived={archived}
              onDelete={() => openDialog(type === 'area' ? { kind: 'deleteCategory', id: fm.id } : { kind: 'delete', id: fm.id })}
            />
          )}
          {!sheet && <button onClick={close} className="icon-btn small ghost" title={t('common.close')} aria-label={t('common.close')}><X size={16} /></button>}
        </div>
        <div className="item-facts">
          {canRetype ? <KindPicker type={type} onPick={(k) => void patch({ type: k })} /> : (
            <span className="kind-badge is-static"><span className="kind-tile"><TypeIcon type={type} size={15} /></span><span>{t(`type.${type}` as TKey)}</span></span>
          )}
          {fm && detail && gnode && hasCategory && <CategoryPicker node={gnode} onPick={(title) => void patch({ area: title ? `[[${title}]]` : '' })} />}
          {fm && detail && gnode && <KindFacts node={gnode} detail={detail} patch={patch} />}
          {archived && <span className="chip is-static s-archived"><Archive size={12} />{t('panel.archivedBadge')}</span>}
        </div>
        {!fm && <h2 className="item-title mt-3 utext" dir="auto">{gnode?.title}</h2>}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 text-sm">
        {error && <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">{error}</div>}
        {ghost && (
          <div className="space-y-3">
            <p className="text-muted">{t('panel.ghost')}</p>
            <button onClick={() => void materialize()} className="btn-primary">{t('panel.materialize')}</button>
          </div>
        )}
        {fm && detail && gnode && history && (
          <div className="space-y-5">
            <section className="item-card">
              <InlineText value={fm.title} placeholder={t('panel.titlePh')} onSave={(v) => { if (v) return patch({ title: v }); }} className="item-title" />
              <InlineText value={fm.summary} placeholder={t('panel.summaryPh')} multiline onSave={(v) => patch({ summary: v.slice(0, 160) })} className="item-lead" />
              <div className="item-card-sep" />
              <div className="mb-2 flex items-center gap-3">
                <span className="section-title mb-0">{t('panel.details')}</span>
                {!editing && (
                  <button onClick={() => { setBodyDraft(detail.node.body); setEditing(true); }} className="flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline">
                    <Pencil size={11} />{history.text ? t('panel.editText') : t('panel.write')}
                  </button>
                )}
              </div>
              {editing ? (
                <div className="space-y-2">
                  <Suspense fallback={<div className="field text-muted">{t('common.loading')}</div>}><BodyEditor key={detail.node.fm.id} initial={detail.node.body} onChange={setBodyDraft} /></Suspense>
                  <div className="flex gap-2">
                    <button onClick={() => void saveBody()} className="btn-primary"><Check size={14} />{t('common.save')}</button>
                    <button onClick={() => setEditing(false)} className="btn-ghost">{t('common.cancel')}</button>
                  </div>
                </div>
              ) : history.text ? <div className="reading"><Markdown text={history.text} resolve={resolve} /></div> : <p className="text-xs text-muted">{t('panel.empty')}</p>}
              {!editing && history.entries.length > 0 && (
                <ol className="timeline" aria-label={t('panel.history')}>
                  {history.entries.map((e, i) => (
                    <li key={`${e.date}-${i}`} className="tl-row">
                      <span className={`tl-dot ${e.kind}`} />
                      <span className="tl-date">{fmtDate(e.date, locale, { month: 'long', day: 'numeric' })}</span>
                      <span className="tl-text utext" dir="auto">{e.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {type === 'area' ? <CategorySummary id={fm.id} /> : type === 'map' ? <MapSummary id={fm.id} /> : <KindBlock node={gnode} detail={detail} patch={patch} />}

            {connected.size > 0 && (
              <section>
                <h3 className="section-title">{t('panel.connected')}</h3>
                <ul className="space-y-0.5">
                  {[...connected.values()].sort((a, b) => KIND_ORDER.indexOf((a.node?.type ?? 'note') as never) - KIND_ORDER.indexOf((b.node?.type ?? 'note') as never)).map((b) => (
                    <li key={b.id}>
                      <button onClick={() => select(b.id)} className={`row w-full text-start ${b.faded ? 'opacity-60' : ''}`}>
                        <TypeIcon type={b.node?.ghost ? 'ghost' : b.node?.type ?? 'note'} size={14} color={palette.node(b.node)} />
                        <span className="min-w-0 flex-1 truncate utext" dir="auto">{b.title}</span>
                        <span className="shrink-0 text-[10.5px] text-muted">{b.note || t(`type.${b.node?.ghost ? 'ghost' : b.node?.type ?? 'note'}` as TKey)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {type !== 'inbox' && related.length > 0 && (
              <section>
                <h3 className="section-title" title={t('panel.relatedHint')}>{t('panel.related')}</h3>
                <ul className="space-y-0.5">
                  {related.map((h) => (
                    <li key={h.id} className="row">
                      <button onClick={() => select(h.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
                        <TypeIcon type={h.type} size={14} color={palette.node(byId.get(h.id))} />
                        <span className="min-w-0 flex-1 truncate utext" dir="auto">{h.title}</span>
                      </button>
                      <button onClick={() => void linkRelated(h)} className="icon-btn tiny ghost" title={t('panel.link')} aria-label={t('panel.link')}><Link2 size={13} /></button>
                      <button onClick={() => void dismissRelated(h)} className="icon-btn tiny ghost" title={t('panel.dismiss')} aria-label={t('panel.dismiss')}><X size={13} /></button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <details className="more-box">
              <summary><ChevronDown size={13} className="more-chevron" />{t('panel.more')}</summary>
              <div className="mt-3 space-y-3">
                <Labeled label={t('panel.tags')}><ChipInput values={fm.tags} onChange={(tags) => void patch({ tags })} placeholder={t('panel.addTag')} /></Labeled>
                <Labeled label={t('panel.aliases')}><ChipInput values={fm.aliases} onChange={(aliases) => void patch({ aliases })} placeholder={t('panel.addAlias')} /></Labeled>
                {type !== 'event' && type !== 'person' && type !== 'area' && (
                  <Labeled label={t('panel.people')}><ChipInput values={fm.people.map(plainTitle)} onChange={(people) => void patch({ people: people.map((p) => `[[${plainTitle(p)}]]`) })} suggestions={personTitles} placeholder={t('panel.addPerson')} /></Labeled>
                )}
                <dl className="props">
                  <dt>{t('panel.created')}</dt><dd className="text-muted">{fmtDateTime(fm.created, locale)}</dd>
                  <dt>{t('panel.updated')}</dt><dd className="text-muted">{fmtDateTime(fm.updated, locale)}</dd>
                  {fm.completed && <><dt>{t('panel.completed')}</dt><dd className="text-muted">{fmtDate(fm.completed, locale, { dateStyle: 'medium' })}</dd></>}
                  <dt>{t('panel.path')}</dt><dd className="truncate font-mono text-[11px] text-muted" dir="ltr">{detail.node.path}</dd>
                </dl>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <div><span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>{children}</div>;
}

/** The kind as a badge in the item's colour; the menu turns the item into another kind (its file moves folders). */
function KindPicker({ type, onPick }: { type: string; onPick: (kind: string) => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="kind-badge" title={t('panel.kindHint')}>
          <span className="kind-tile"><TypeIcon type={type} size={15} /></span>
          <span>{t(`type.${type}` as TKey)}</span>
          <ChevronDown size={12} className="chip-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu max-h-[70vh] overflow-y-auto" sideOffset={6} align="start" collisionPadding={10}>
          <div className="menu-title">{t('panel.changeKind')}</div>
          {ADDABLE_KINDS.map((k) => (
            <DropdownMenu.Item key={k} className="menu-item has-hint" onSelect={() => { if (k !== type) onPick(k); }}>
              <span className="menu-icon"><TypeIcon type={k} size={14} /></span>
              <span className="min-w-0 flex-1"><span className="block">{t(`type.${k}` as TKey)}</span><span className="menu-hint">{t(`kindHint.${k}` as TKey)}</span></span>
              {k === type && <Check size={14} className="shrink-0 text-accent" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The item's category as a coloured chip; picking another one moves the item there. */
function CategoryPicker({ node, onPick }: { node: UiGraphNode | undefined; onPick: (title: string | null) => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const palette = usePalette();
  const current = node?.category ? palette.category(node.category) : undefined;
  const inferred = node?.categorySource === 'links' || node?.categorySource === 'project';
  return (
    <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className={`chip cat-pick ${current ? '' : 'is-empty'}`} style={{ '--chip': palette.group(node?.category ?? null) } as React.CSSProperties} title={inferred ? t('panel.categoryInferred') : t('panel.area')}>
          <span className="legend-dot" />
          <span className="min-w-0 truncate utext" dir="auto">{current?.title ?? t('panel.noCategory')}</span>
          {inferred && <span className="opacity-60">· {t('panel.inferredShort')}</span>}
          <ChevronDown size={12} className="chip-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu max-h-80 overflow-y-auto" sideOffset={6} align="start" collisionPadding={10}>
          <div className="menu-title">{t('panel.area')}</div>
          {inferred && current && (
            <>
              <DropdownMenu.Item className="menu-item text-accent" onSelect={() => onPick(current.title)}><Check size={14} />{t('panel.makeExplicit')}</DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-sep" />
            </>
          )}
          {palette.categories.map((c) => (
            <DropdownMenu.Item key={c.id} className="menu-item" onSelect={() => onPick(c.title)}>
              <span className="legend-dot" style={{ '--chip': palette.group(c.id) } as React.CSSProperties} />
              <span className="min-w-0 flex-1 truncate utext" dir="auto">{c.title}</span>
              {c.id === current?.id && <Check size={14} className="text-accent" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item text-muted" onSelect={() => onPick(null)}>{t('panel.noCategory')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ItemMenu({ onMap, onEdit, onCopy, onArchive, archived, onDelete }: { onMap?: () => void; onEdit: () => void; onCopy: () => void; onArchive?: () => void; archived: boolean; onDelete: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="icon-btn small ghost" aria-label={t('common.more')} title={t('common.more')}><MoreHorizontal size={16} /></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" sideOffset={6} align="end" collisionPadding={10}>
          {onMap && <DropdownMenu.Item className="menu-item" onSelect={onMap}><MapIcon size={14} />{t('panel.showOnMap')}</DropdownMenu.Item>}
          <DropdownMenu.Item className="menu-item" onSelect={onEdit}><Pencil size={14} />{t('panel.editText')}</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={onCopy}><Copy size={14} />{t('menu.copy')}</DropdownMenu.Item>
          {onArchive && <DropdownMenu.Item className="menu-item" onSelect={onArchive}>{archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{archived ? t('panel.unarchive') : t('panel.archive')}</DropdownMenu.Item>}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item is-danger" onSelect={onDelete}><Trash2 size={14} />{t('common.delete')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A map opened as an item (UI-DESIGN "Maps"): what it connects to, its categories, and — for the character map — the brain's rebuild. */
function MapSummary({ id }: { id: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const run = useStore((s) => s.run);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openPlace = useStore((s) => s.openPlace);
  const requestFly = useStore((s) => s.requestFly);
  const openDialog = useStore((s) => s.openDialog);
  const setToast = useStore((s) => s.setToast);
  const palette = usePalette();
  const { byId } = useMaps();
  const map = byId(id);
  const categories = palette.categories.filter((c) => c.map === id);
  const members = (graph?.nodes ?? []).filter((n) => n.map === id && n.type !== 'area' && !n.ghost);
  const building = run !== null && run.mode === 'character' && (run.status === 'running' || run.status === 'queued');
  const build = async (): Promise<void> => {
    const r = await startRun({ prompt: '/character', mode: 'character', display: t('maps.buildCharacter'), newThread: true });
    if (r) setToast(t('maps.building'));
  };
  if (!map) return null;
  const setSymbol = async (symbol: string): Promise<void> => {
    try { await api.updateNode(id, { frontmatter: { facets: { symbol } } }); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <section>
        <h3 className="section-title">{t('maps.connections')}</h3>
        <div className="flex flex-wrap gap-1.5"><MapConnections map={map} /></div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{t(map.apart ? 'maps.offHint' : 'maps.connectHint')}</p>
      </section>
      <section>
        <h3 className="section-title">{t('maps.symbol')}</h3>
        <SymbolPicker value={map.symbol} onChange={(s) => void setSymbol(s)} />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{t('maps.symbolHint')}</p>
      </section>
      <section>
        <h3 className="section-title">{t('category.color')}</h3>
        <ColorPopover id={id} value={map.color} hint={t('color.islandHint')} align="start">
          <button type="button" className="color-chip" aria-label={t('color.change')} title={t('color.change')}>
            <span className="color-dot" style={{ background: palette.base(id) }} />
            {map.color ? <bdi dir="ltr">{map.color}</bdi> : t('category.autoColor')}
          </button>
        </ColorPopover>
      </section>
      <section>
        <h3 className="section-title">{t('maps.categories')}</h3>
        {categories.length === 0 ? <p className="text-xs text-muted">{t('maps.noCategories')}</p> : (
          <ul className="space-y-0.5">
            {categories.map((c) => (
              <li key={c.id}>
                <button onClick={() => { if (view !== 'graph') setView('graph'); openPlace(c.id); requestFly([], c.id); }} className="row w-full text-start">
                  <span className="legend-dot" style={{ '--chip': palette.group(c.id) } as React.CSSProperties} />
                  <span className="min-w-0 flex-1 truncate utext" dir="auto">{c.title}</span>
                  <span className="shrink-0 text-[10.5px] text-muted">{t('item.count').replace('{n}', fmtNum(members.filter((n) => n.category === c.id).length, locale))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap gap-2">
        {map.role === 'character' && (
          <button onClick={() => void build()} disabled={building} className="btn-primary">{building ? t('maps.building') : members.length ? t('maps.rebuild') : t('maps.build')}</button>
        )}
        <button onClick={() => { if (view !== 'graph') setView('graph'); requestFly([], undefined, id); }} className="btn-soft"><MapIcon size={14} />{t('maps.show')}</button>
        <button onClick={() => openDialog({ kind: 'category', map: map.title })} className="btn-soft"><Plus size={14} />{t('maps.addCategory')}</button>
      </div>
      {map.role === 'character' && <p className="text-[11px] leading-relaxed text-muted">{t('maps.characterHint')}</p>}
    </div>
  );
}

/** A category opened as an item: what it holds by kind, and the ways in. */
function CategorySummary({ id }: { id: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setView = useStore((s) => s.setView);
  const setCategoryPage = useStore((s) => s.setCategoryPage);
  const openPlace = useStore((s) => s.openPlace);
  const requestFly = useStore((s) => s.requestFly);
  const openDialog = useStore((s) => s.openDialog);
  const members = (graph?.nodes ?? []).filter((n) => n.category === id && n.id !== id && !n.ghost);
  const counts = KIND_ORDER.map((k) => [k, members.filter((n) => n.type === k).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {counts.map(([k, n]) => <span key={k} className="flex items-center gap-1.5"><TypeIcon type={k} size={13} />{fmtNum(n, locale)} {t(`kinds.${k}` as TKey)}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setCategoryPage(id); setView('categories'); }} className="btn-soft">{t('place.seeAll')}</button>
        <button onClick={() => { setView('graph'); openPlace(id); requestFly([], id); }} className="btn-soft"><MapIcon size={14} />{t('category.showInGraph')}</button>
        <button onClick={() => openDialog({ kind: 'add', category: id })} className="btn-soft"><Plus size={14} />{t('place.add')}</button>
      </div>
    </div>
  );
}
