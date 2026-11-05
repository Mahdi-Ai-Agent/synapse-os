import { ChevronDown, Map as MapIcon, MoreHorizontal, Palette, Plus, Trash2, Check, ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CategoryInfo, MapInfo } from '@synapse/core';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { fmtDate, fmtNum, sep, todayStr } from '../lib/format';
import { useMaps } from '../lib/maps';
import { analysisLead, MAP_PLACE, membersOf, MIND, placeRuns, placeStats, spacesOf, treeOf, type PlaceBranch, type PlaceTree } from '../lib/places';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ActCheck } from '../components/ActCheck';
import { ActionsByPlace } from '../components/ActionsByPlace';
import { PlaceGraph } from '../components/PlaceGraph';
import { ColorPopover } from '../components/ColorPicker';
import { Markdown, useResolve } from '../components/Markdown';
import { OpenInChat, useReviewRun } from '../components/ReviewRun';
import { TypeIcon } from '../components/TypeIcon';
import { ZoneGlyph } from '../components/ZoneGlyph';
import { Card, CardTitle, CategoryChip, Empty } from '../components/ui';
import { InlineText } from '../kinds/fields';
import { CLOSED } from '../graph/model';

const SPECIAL_KEY: Record<string, TKey> = { __inbox: 'group.inbox', __journal: 'group.journal', __unsorted: 'group.unsorted', __archive: 'group.archive' };
const SPECIAL_COLOR: Record<string, string> = { __inbox: '#e8e4d8', __journal: '#e3c79a', __unsorted: '#9aa3b2', __archive: '#6b7280' };

type Tab = 'whole' | 'graph' | 'attention' | 'analysis';

/**
 * Categories and islands (spec: docs/UI-DESIGN.md "Places"): first every place as a card with its name and nothing
 * else; a place opens as a quiet hero over its contents from the whole to the parts, what needs attention there in
 * the brain's order, and the brain's analysis of it.
 */
export function PlacesView() {
  const current = useStore((s) => s.categoryPage);
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {current === 'all' ? <PlacesHome /> : <PlacePage key={current} id={current} />}
    </div>
  );
}

function PlacesHome() {
  const t = useT();
  const graph = useStore((s) => s.graph);
  const openDialog = useStore((s) => s.openDialog);
  const setPage = useStore((s) => s.setCategoryPage);
  const palette = usePalette();
  const maps = useMaps();
  const spaces = useMemo(() => spacesOf(graph?.categories ?? [], graph?.maps ?? []), [graph]);
  const mind = spaces.find((s) => s.id === MIND);
  const islands = spaces.filter((s) => s.mapId);
  return (
    <div className="view-body view-wide places">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t('places.title')}</h1>
          <p className="view-sub">{t('places.hintShort')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openDialog({ kind: 'map' })} className="btn-soft"><Plus size={15} />{t('places.newMap')}</button>
          <button onClick={() => openDialog({ kind: 'category' })} className="btn-primary"><Plus size={15} />{t('places.newCategory')}</button>
        </div>
      </header>
      <h2 className="places-heading">{t('places.categoriesHeading')}</h2>
      <div className="name-grid">
        {(mind?.categories ?? []).map((c) => (
          <button key={c.id} onClick={() => setPage(c.id)} className="name-card" style={{ '--cat': palette.group(c.id) } as CSSProperties}>
            <span className="name-card-glow" /><span className="name-card-title utext" dir="auto">{c.title}</span>
          </button>
        ))}
      </div>
      {islands.length > 0 && (
        <>
          <h2 className="places-heading">{t('places.islandsHeading')}</h2>
          <div className="name-grid">
            {islands.map((sp) => {
              const m = sp.mapId ? maps.byId(sp.mapId) : undefined;
              if (!m) return null;
              return (
                <button key={sp.id} onClick={() => setPage(sp.id)} className="name-card is-island" style={{ '--cat': maps.color(m.id) } as CSSProperties}>
                  <span className="name-card-glow" /><span className="name-card-mark"><ZoneGlyph symbol={m.symbol} size={18} /></span>
                  <span className="name-card-title utext" dir="auto">{m.title}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** What the page knows about the place it shows. */
interface Place {
  kind: 'category' | 'map' | 'mind' | 'special';
  title: string;
  summary: string;
  color: string;
  cat?: CategoryInfo;
  map?: MapInfo;
  /** The vault node behind it (an area or a map): what edits and the analysis go to. */
  nodeId: string | null;
}

function usePlace(id: string): Place | null {
  const t = useT();
  const graph = useStore((s) => s.graph);
  const palette = usePalette();
  const maps = useMaps();
  if (id === MIND) return { kind: 'mind', title: t('maps.mind'), summary: t('places.mindHint'), color: '#8f9fff', nodeId: null };
  if (id.startsWith(MAP_PLACE)) {
    const m = maps.byId(id.slice(MAP_PLACE.length));
    return m ? { kind: 'map', title: m.title, summary: m.summary, color: maps.color(m.id), map: m, nodeId: m.id } : null;
  }
  if (SPECIAL_KEY[id]) return { kind: 'special', title: t(SPECIAL_KEY[id]!), summary: '', color: SPECIAL_COLOR[id]!, nodeId: null };
  const cat = palette.category(id) ?? graph?.categories.find((c) => c.id === id);
  return cat ? { kind: 'category', title: cat.title, summary: cat.summary === cat.title ? '' : cat.summary, color: palette.group(cat.id), cat, nodeId: cat.id } : null;
}

function PlacePage({ id }: { id: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setPage = useStore((s) => s.setCategoryPage);
  const place = usePlace(id);
  const today = todayStr();
  const items = useMemo(() => membersOf(id, graph?.nodes ?? [], today), [id, graph, today]);
  const [tab, setTab] = useState<Tab>('whole');
  const Back = locale === 'fa' ? ArrowRight : ArrowLeft;
  if (!place) {
    return (
      <div className="view-body">
        <button onClick={() => setPage('all')} className="mb-3 flex items-center gap-1.5 text-xs text-muted hover:text-text"><Back size={14} />{t('places.back')}</button>
        <Empty>{t('places.gone')}</Empty>
      </div>
    );
  }
  const spaceCats = place.kind === 'map' ? (graph?.categories ?? []).filter((c) => c.map === place.map?.id && c.status !== 'archived') : place.kind === 'mind' ? (graph?.categories ?? []).filter((c) => !c.map && c.status !== 'archived') : [];
  const tabs: Tab[] = place.nodeId ? ['whole', 'graph', 'attention', 'analysis'] : ['whole', 'graph', 'attention'];
  // The small map's centres: the category itself, or an island's centre and its categories (the mind map: its categories).
  const hubs = place.kind === 'category' ? [id] : [...(place.map ? [place.map.id] : []), ...spaceCats.map((c) => c.id)];
  return (
    <div className="view-body view-wide places" style={{ '--cat': place.color } as CSSProperties}>
      <button onClick={() => setPage('all')} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-text"><Back size={14} />{t('places.back')}</button>
      <PlaceHero id={id} place={place} items={items} categories={spaceCats.length} />
      <div className="place-tabs" role="tablist">
        {tabs.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`place-tab ${tab === k ? 'is-on' : ''}`}>{t(`places.tab.${k}` as TKey)}</button>)}
      </div>
      <div className="mt-6">
        {tab === 'whole' && (spaceCats.length ? <SpaceWhole cats={spaceCats} /> : <PlaceWhole items={items} />)}
        {tab === 'graph' && <PlaceGraph items={items} hubs={hubs} />}
        {tab === 'attention' && <ActionsByPlace nodes={items} title={t('places.tab.attention')} />}
        {tab === 'analysis' && place.nodeId && <PlaceAnalysis pageId={id} nodeId={place.nodeId} title={place.title} />}
      </div>
    </div>
  );
}

/** An island or the mind map: each of its categories, whole to parts, folded after the first ones. */
function SpaceWhole({ cats }: { cats: CategoryInfo[] }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setPage = useStore((s) => s.setCategoryPage);
  const palette = usePalette();
  const today = todayStr();
  return (
    <div className="space-y-4">
      {cats.map((c, i) => {
        const items = membersOf(c.id, graph?.nodes ?? [], today);
        return (
          <details key={c.id} className="space-cat" open={i < 3} style={{ '--cat': palette.group(c.id) } as CSSProperties}>
            <summary>
              <span className="cat-orb small" />
              <span className="min-w-0 flex-1 truncate font-display text-[17px] font-bold utext" dir="auto">{c.title}</span>
              <span className="text-[12px] text-muted">{t('item.count').replace('{n}', fmtNum(items.length, locale))}</span>
              <button onClick={(e) => { e.preventDefault(); setPage(c.id); }} className="link-btn">{t('places.openPage')}</button>
              <ChevronDown size={15} className="fold-icon text-muted" />
            </summary>
            <div className="mt-3"><PlaceWhole items={items} /></div>
          </details>
        );
      })}
    </div>
  );
}

/** One place's items from the whole to the parts: larger items with what they hold, then the rest by kind. */
function PlaceWhole({ items }: { items: UiGraphNode[] }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const today = todayStr();
  const tree: PlaceTree = useMemo(() => treeOf(items, graph?.edges ?? [], today), [items, graph, today]);
  if (!tree.branches.length && !tree.loose.length) return <Empty>{t('category.empty')}</Empty>;
  return (
    <div className="space-y-6">
      {tree.branches.length > 0 && <div className="branch-grid">{tree.branches.map((b) => <BranchCard key={b.node.id} branch={b} />)}</div>}
      {tree.loose.map((g) => (
        <section key={g.kind}>
          <h3 className="kind-section-title"><TypeIcon type={g.kind} size={15} />{t(`kinds.${g.kind}` as TKey)}<span>{fmtNum(g.items.length, locale)}</span></h3>
          <div className="leaf-grid">{g.items.map((n) => <Leaf key={n.id} node={n} />)}</div>
        </section>
      ))}
      {tree.retired.length > 0 && (
        <details className="focus-more">
          <summary><ChevronDown size={13} />{t('places.retired')} <span>{fmtNum(tree.retired.length, locale)}</span></summary>
          <div className="leaf-grid mt-2">{tree.retired.map((n) => <Leaf key={n.id} node={n} />)}</div>
        </details>
      )}
    </div>
  );
}

function BranchCard({ branch }: { branch: PlaceBranch }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const select = useStore((s) => s.select);
  const palette = usePalette();
  const n = branch.node;
  const color = palette.node(n);
  const progress = typeof n.facets['progress'] === 'number' ? (n.facets['progress'] as number) : null;
  const open = branch.children.filter((c) => !CLOSED.has(c.status)).length;
  return (
    <article className="branch-card" style={{ '--chip': color } as CSSProperties}>
      <button onClick={() => select(n.id)} className="branch-head">
        <span className="branch-icon"><TypeIcon type={n.type} size={18} color={color} /></span>
        <span className="min-w-0 flex-1 text-start">
          <span className="branch-kind">{t(`type.${n.type}` as TKey)}</span>
          <span className="branch-title utext" dir="auto">{n.title}</span>
          {n.summary && <span className="branch-sub utext" dir="auto">{n.summary}</span>}
        </span>
        {progress !== null && <span className="branch-progress">{fmtNum(Math.round(progress), locale)}٪</span>}
      </button>
      {branch.children.length > 0 ? (
        <ul className="branch-children">
          {branch.children.map((c) => (
            <li key={c.id}>
              <div className={`row cursor-pointer ${CLOSED.has(c.status) ? 'is-checked' : ''}`} onClick={() => select(c.id)}>
                <ActCheck node={c} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text utext" dir="auto">{c.title}</span>
                {c.due && <span className="text-[11px] text-muted">{fmtDate(c.due, locale, { month: 'short', day: 'numeric' })}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="branch-empty">{t('places.branchEmpty')}</p>}
      {branch.children.length > 0 && <p className="branch-foot">{t('places.branchOpen').replace('{n}', fmtNum(open, locale)).replace('{all}', fmtNum(branch.children.length, locale))}</p>}
    </article>
  );
}

function Leaf({ node }: { node: UiGraphNode }) {
  const select = useStore((s) => s.select);
  return (
    <div className={`leaf ${CLOSED.has(node.status) ? 'is-checked' : ''}`} onClick={() => select(node.id)}>
      <ActCheck node={node} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text utext" dir="auto">{node.title}</span>
        {node.summary && node.summary !== node.title && <span className="block truncate text-[11.5px] text-muted utext" dir="auto">{node.summary}</span>}
      </span>
    </div>
  );
}

function PlaceHero({ id, place, items, categories }: { id: string; place: Place; items: UiGraphNode[]; categories: number }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setView = useStore((s) => s.setView);
  const openPlace = useStore((s) => s.openPlace);
  const requestFly = useStore((s) => s.requestFly);
  const openDialog = useStore((s) => s.openDialog);
  const setToast = useStore((s) => s.setToast);
  const today = todayStr();
  const stats = placeStats(items, today);
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    if (!place.nodeId) return;
    try { await api.updateNode(place.nodeId, { frontmatter: patch }); } catch (e) { setToast((e as Error).message); }
  };
  const showOnMap = (): void => {
    setView('graph');
    if (place.kind === 'category') { openPlace(id); requestFly([], id); return; }
    if (place.kind === 'map' && place.map) { requestFly([], undefined, place.map.id); return; }
    requestFly(items.map((n) => n.id));
  };
  const editable = place.kind === 'category' || place.kind === 'map';
  const islands = (graph?.maps ?? []).filter((m) => m.status !== 'archived');
  return (
    <header className="place-hero2">
      <div className="flex items-start gap-3">
        {place.kind === 'map' || place.kind === 'mind' ? <span className="space-glyph large"><ZoneGlyph symbol={place.map ? place.map.symbol : 'brain'} size={26} /></span> : <span className="cat-orb" />}
        <div className="min-w-0 flex-1">
          {editable ? (
            <>
              <InlineText value={place.title} placeholder={t('category.namePh')} onSave={(v) => { if (v) return save({ title: v }); }} className="cat-title" />
              <InlineText value={place.summary} placeholder={t('category.summaryPh')} multiline onSave={(v) => save({ summary: (v || place.title).slice(0, 160) })} className="item-summary mt-0.5" />
            </>
          ) : (
            <>
              <h2 className="cat-title px-1">{place.title}</h2>
              {place.summary && <p className="item-summary px-1">{place.summary}</p>}
            </>
          )}
          <p className="place-facts">{[...(place.kind === 'map' || place.kind === 'mind' ? [t('places.categories').replace('{n}', fmtNum(categories, locale))] : []), t('item.count').replace('{n}', fmtNum(stats.items, locale)), ...(stats.urgent ? [t('actions.urgent').replace('{n}', fmtNum(stats.urgent, locale))] : [])].join(sep(locale))}</p>
        </div>
        {editable && place.nodeId && (
          <div className="flex items-center gap-1">
            <ColorPopover id={place.nodeId} value={place.cat?.color ?? place.map?.color ?? null} hint={place.kind === 'map' ? t('color.islandHint') : t('color.categoryHint')}>
              <button className="icon-btn small ghost" aria-label={t('color.change')} title={t('color.change')}><Palette size={16} /></button>
            </ColorPopover>
            <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
              <DropdownMenu.Trigger asChild>
                <button className="icon-btn small ghost" aria-label={t('common.more')} title={t('common.more')}><MoreHorizontal size={16} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" sideOffset={6} align="end" collisionPadding={10}>
                  {place.kind === 'category' && place.cat && (
                    <>
                      <div className="menu-label">{t('places.moveTo')}</div>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void save({ map: null })}>{!place.cat.map && <Check size={13} />}{t('maps.mind')}</DropdownMenu.Item>
                      {islands.map((m) => (
                        <DropdownMenu.Item key={m.id} className="menu-item" onSelect={() => void save({ map: `[[${m.title}]]` })}>{place.cat?.map === m.id && <Check size={13} />}<bdi>{m.title}</bdi></DropdownMenu.Item>
                      ))}
                      <DropdownMenu.Separator className="menu-sep" />
                      <DropdownMenu.Item className="menu-item is-danger" onSelect={() => openDialog({ kind: 'deleteCategory', id: place.nodeId! })}><Trash2 size={14} />{t('category.delete')}</DropdownMenu.Item>
                    </>
                  )}
                  {place.kind === 'map' && place.map && (
                    <DropdownMenu.Item className="menu-item" onSelect={() => openDialog({ kind: 'category', map: place.map!.title })}><Plus size={14} />{t('places.newCategoryHere')}</DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {place.kind === 'category' && <button onClick={() => openDialog({ kind: 'add', category: id })} className="btn-primary"><Plus size={15} />{t('category.addHere')}</button>}
        {items.length > 0 && <button onClick={showOnMap} className="btn-soft"><MapIcon size={14} />{t('category.showInGraph')}</button>}
      </div>
    </header>
  );
}

interface Analysis { path: string | null; text: string | null }
const NO_ANALYSIS: Analysis = { path: null, text: null };

/** A place's analysis and the file it lives in, read again when an insight run ends. */
function useAnalysis(nodeId: string | null): Analysis {
  const live = useStore((s) => s.run);
  const [analysis, setAnalysis] = useState<Analysis>(NO_ANALYSIS);
  const finished = live?.mode === 'insight' && live.status === 'done' ? live.runId : null;
  useEffect(() => {
    if (!nodeId) { setAnalysis(NO_ANALYSIS); return; }
    let alive = true;
    api.placeAnalysis(nodeId).then((x) => { if (alive) setAnalysis(x); }).catch(() => { if (alive) setAnalysis(NO_ANALYSIS); });
    return () => { alive = false; };
  }, [nodeId, finished]);
  return analysis;
}


function PlaceAnalysis({ pageId, nodeId, title }: { pageId: string; nodeId: string; title: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const resolve = useResolve();
  const { path, text } = useAnalysis(nodeId);
  const { run, running, busy, threadId } = useReviewRun();
  const live = useStore((s) => s.run);
  const [started, setStarted] = useState<string | null>(null);
  // The app names the file, so the brain never has to work out a place's file name.
  const prompt = path ? `[[${title}]] → ${path}` : `[[${title}]]`;
  const start = async (): Promise<void> => {
    const r = await run('insight', t('places.analyzeLabel').replace('{name}', title), prompt);
    if (r) { placeRuns.set(r.runId, { id: pageId, title }); setStarted(r.runId); }
  };
  const date = text ? /^#\s+.*?(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1] ?? null : null;
  const body = text ? text.replace(/^#\s+.*\n/, '').trim() : '';
  // Only this place's own analysis shows as under way here (another place's may be running).
  const analyzing = running === 'insight' && live !== null && (live.runId === started || placeRuns.get(live.runId)?.id === pageId);
  return (
    <Card>
      <CardTitle>{t('places.tab.analysis')}</CardTitle>
      {date && <p className="-mt-1 mb-2 text-[11px] text-muted">{fmtDate(date, locale, { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
      {text ? <div className="reading"><Markdown text={body} resolve={resolve} /></div> : <Empty>{t('places.noAnalysis')}</Empty>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => void start()} disabled={busy || !path} className="btn-primary">
          {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{analyzing ? t('places.analyzing') : text ? t('places.reanalyze') : t('places.analyze')}
        </button>
        {analyzing && <OpenInChat threadId={threadId} />}
      </div>
    </Card>
  );
}
