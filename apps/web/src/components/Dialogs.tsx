import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { autoTone, categoryHue, familyBaseRgb, rgbToHex } from '../graph/colors';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { startRun } from '../lib/brain';
import { usePalette } from '../lib/categories';
import { inputDir, todayStr } from '../lib/format';
import { MIND, useMaps } from '../lib/maps';
import { ZONE_SYMBOLS } from '../graph/zoneGlyphs';
import { useStore } from '../state/store';
import { ChipInput, plainTitle } from './ChipInput';
import { ColorPicker } from './ColorPicker';
import { Toggle } from './graph/GraphToolbar';
import { TypeIcon } from './TypeIcon';
import { ZoneGlyph } from './ZoneGlyph';
import { DateField, Segmented } from '../kinds/fields';
import { ADDABLE_KINDS, CADENCES, RELATIONS, TIMES, type AddableKind } from '../kinds/meta';
import { MoodPicker } from '../kinds/widgets';


/** The app's modal dialogs (spec: docs/UI-DESIGN.md "Adding things"), driven by `store.dialog`. */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const close = useStore((s) => s.closeDialog);
  const locale = useStore((s) => s.locale);
  if (!dialog) return null;
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${dialog.kind === 'add' ? 'is-wide' : ''}`} dir={locale === 'fa' ? 'rtl' : 'ltr'} aria-describedby={undefined}>
          {dialog.kind === 'category' && <CategoryForm editId={dialog.editId} map={dialog.map} />}
          {dialog.kind === 'map' && <MapForm />}
          {dialog.kind === 'add' && <AddForm key={`${dialog.type ?? ''}|${dialog.category ?? ''}|${dialog.title ?? ''}`} type={dialog.type} category={dialog.category} title={dialog.title} />}
          {dialog.kind === 'delete' && <DeleteNode id={dialog.id} />}
          {dialog.kind === 'deleteCategory' && <DeleteCategory id={dialog.id} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <Dialog.Title className="dialog-title">{children}</Dialog.Title>;
}

function Actions({ busy, submit, label, danger = false, disabled = false }: { busy: boolean; submit: () => void; label: string; danger?: boolean; disabled?: boolean }) {
  const t = useT();
  const close = useStore((s) => s.closeDialog);
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button onClick={close} className="btn-ghost">{t('common.cancel')}</button>
      <button onClick={submit} disabled={busy || disabled} className={danger ? 'btn-danger' : 'btn-primary'}>{busy && <Loader2 size={14} className="animate-spin" />}{label}</button>
    </div>
  );
}


function CategoryForm({ editId, map }: { editId?: string; map?: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const close = useStore((s) => s.closeDialog);
  const setToast = useStore((s) => s.setToast);
  const requestFly = useStore((s) => s.requestFly);
  const setCategoryPage = useStore((s) => s.setCategoryPage);
  const graph = useStore((s) => s.graph);
  const palette = usePalette();
  const existing = editId ? graph?.categories.find((c) => c.id === editId) : undefined;
  // Automatic: a category in a map takes the map's colour, any other the next hue of the sequence.
  const mapId = map ? graph?.maps.find((m) => m.title === map)?.id : existing?.map ?? undefined;
  const auto = existing ? palette.auto(existing.id) : mapId ? palette.base(mapId) : rgbToHex(familyBaseRgb(autoTone(categoryHue(graph?.categories.length ?? 0))));
  const [title, setTitle] = useState(existing?.title ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (existing) {
        await api.updateNode(existing.id, { frontmatter: { title: title.trim(), summary: (summary.trim() || title.trim()).slice(0, 160), color: color ?? null } });
      } else {
        // A category made from a map's card goes into that map (VAULT-SPEC "Maps").
        const d = await api.createNode({ type: 'area', title: title.trim(), summary: (summary.trim() || title.trim()).slice(0, 160), ...(color ? { color } : {}), ...(map ? { map: `[[${map}]]` } : {}) });
        setCategoryPage(d.node.fm.id);
        setTimeout(() => requestFly([], d.node.fm.id), 600);
      }
      close();
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <Title>{existing ? t('category.edit') : t('category.new')}</Title>
      <p className="mt-1 text-xs leading-relaxed text-muted">{map ? t('category.inMapHint').replace('{map}', map) : t('category.hint')}</p>
      <div className="mt-5 space-y-4">
        <label className="block"><span className="label">{t('category.name')}</span><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full" dir={inputDir(title, locale)} placeholder={t('category.namePh')} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></label>
        <label className="block"><span className="label">{t('category.summary')}</span><input value={summary} maxLength={160} onChange={(e) => setSummary(e.target.value)} className="field w-full" dir={inputDir(summary, locale)} placeholder={t('category.summaryPh')} /></label>
        <div><span className="label">{t('category.color')}</span><ColorPicker value={color} auto={auto} onChange={setColor} hint={mapId ? `${t('color.categoryHint')} ${t('color.followsIsland')}` : t('color.categoryHint')} /></div>
      </div>
      <Actions busy={busy} disabled={!title.trim()} submit={() => void submit()} label={existing ? t('common.save') : t('category.create')} />
    </div>
  );
}

/** A new map (UI-DESIGN "Maps"): its name, what it is for, and whether it starts connected to the mind map and the character map. */
function MapForm() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const close = useStore((s) => s.closeDialog);
  const setToast = useStore((s) => s.setToast);
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);
  const { character } = useMaps();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [symbol, setSymbol] = useState('star');
  const [toMind, setToMind] = useState(true);
  const [toCharacter, setToCharacter] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const connects = [...(toMind ? [MIND] : []), ...(character && toCharacter ? [`[[${character.title}]]`] : [])];
      const d = await api.createNode({ type: 'map', title: title.trim(), summary: (summary.trim() || title.trim()).slice(0, 160), connects, facets: { symbol } });
      close();
      setToast(t('maps.created'));
      setView('graph');
      setTimeout(() => select(d.node.fm.id), 80);
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <Title>{t('maps.new')}</Title>
      <p className="mt-1 text-xs leading-relaxed text-muted">{t('maps.newHint')}</p>
      <div className="mt-5 space-y-4">
        <label className="block"><span className="label">{t('maps.name')}</span><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full" dir={inputDir(title, locale)} placeholder={t('maps.namePh')} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></label>
        <label className="block"><span className="label">{t('maps.purpose')}</span><input value={summary} maxLength={160} onChange={(e) => setSummary(e.target.value)} className="field w-full" dir={inputDir(summary, locale)} placeholder={t('maps.purposePh')} /></label>
        <div><span className="label">{t('maps.symbol')}</span><SymbolPicker value={symbol} onChange={setSymbol} /><p className="mt-1.5 text-[11px] text-muted">{t('maps.symbolHint')}</p></div>
        <div className="space-y-2 text-xs">
          <Toggle label={t('maps.connectMind')} value={toMind} onChange={setToMind} />
          {character && <Toggle label={t('maps.connectCharacter')} value={toCharacter} onChange={setToCharacter} />}
        </div>
      </div>
      <Actions busy={busy} disabled={!title.trim()} submit={() => void submit()} label={t('maps.create')} />
    </div>
  );
}

/** The mark at a map's centre on the canvas (UI-DESIGN "Maps"): one of core's `MAP_SYMBOLS`. */
export function SymbolPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="symbol-grid">
      {ZONE_SYMBOLS.map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className={`symbol-btn ${value === s ? 'is-on' : ''}`} aria-label={s} aria-pressed={value === s}><ZoneGlyph symbol={s} size={18} /></button>
      ))}
    </div>
  );
}

interface Draft {
  title: string; details: string; due: string; project: string; target: string; why: string; cadence: string; time: string;
  date: string; mood: string | null; people: string[]; relation: string; birthday: string; url: string;
}

/**
 * Add something by hand (spec: docs/UI-DESIGN.md "Adding things"): pick what it is, then a short form with only
 * that kind's fields — or skip the form and hand a sentence to the brain, which decides the kind and the category.
 */
function AddForm({ type: initialType, category, title: initialTitle }: { type?: string; category?: string; title?: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const close = useStore((s) => s.closeDialog);
  const setToast = useStore((s) => s.setToast);
  const select = useStore((s) => s.select);
  const requestFly = useStore((s) => s.requestFly);
  const revealChat = useStore((s) => s.revealChat);
  const graph = useStore((s) => s.graph);
  const palette = usePalette();
  const initialKind = (ADDABLE_KINDS as readonly string[]).includes(initialType ?? '') ? (initialType as AddableKind) : null;
  const [kind, setKind] = useState<AddableKind | null>(initialKind);
  const [cat, setCat] = useState<string>(category && palette.category(category) ? category : '');
  const [d, setD] = useState<Draft>({ title: initialTitle ?? '', details: '', due: '', project: '', target: '', why: '', cadence: 'daily', time: '', date: todayStr(), mood: null, people: [], relation: '', birthday: '', url: '', });
  const [free, setFree] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const fetchedFor = useRef('');
  const up = (p: Partial<Draft>): void => setD((x) => ({ ...x, ...p }));
  const Back = locale === 'fa' ? ArrowRight : ArrowLeft;
  const projects = (graph?.nodes ?? []).filter((n) => n.type === 'project' && !n.ghost);
  const people = (graph?.nodes ?? []).filter((n) => n.type === 'person').map((n) => n.title);

  // A pasted link fills the title from its preview.
  useEffect(() => {
    const url = d.url.trim();
    if (kind !== 'resource' || !/^https?:\/\/\S+\.\S+/.test(url) || fetchedFor.current === url) return;
    const id = setTimeout(() => {
      fetchedFor.current = url;
      setFetching(true);
      api.preview(url).then((p) => { if (p.title) setD((x) => (x.title.trim() ? x : { ...x, title: p.title ?? '' })); }).catch(() => undefined).finally(() => setFetching(false));
    }, 350);
    return () => clearTimeout(id);
  }, [d.url, kind]);

  const handToBrain = async (): Promise<void> => {
    const text = free.trim();
    if (!text) return;
    setBusy(true);
    const r = await startRun({ prompt: text, focusId: cat || undefined });
    setBusy(false);
    if (!r) return;
    close();
    setToast(t('add.sentToBrain'), { label: t('nav.chat'), run: revealChat });
  };

  const submit = async (): Promise<void> => {
    if (!kind) return;
    const url = d.url.trim();
    const title = d.title.trim() || (kind === 'resource' && url ? url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80) : '');
    if (!title) return;
    setBusy(true);
    const area = palette.category(cat);
    const facets: Record<string, string | number | string[]> = {};
    const input: Record<string, unknown> = {
      type: kind, title, summary: (d.details.trim() || title).slice(0, 160), source: 'manual',
      ...(area ? { area: `[[${area.title}]]` } : {}), ...(d.details.trim() ? { body: `${d.details.trim()}\n` } : {}),
    };
    if (kind === 'task') { if (d.due) input['due'] = d.due; if (d.project) input['project'] = `[[${d.project}]]`; }
    if (kind === 'project' && d.due) input['due'] = d.due;
    if (kind === 'goal') { facets['progress'] = 0; if (d.target) facets['target'] = d.target; if (d.why.trim()) facets['why'] = d.why.trim(); }
    if (kind === 'habit') { facets['cadence'] = d.cadence; if (d.time) facets['time'] = d.time; }
    if (kind === 'event') { input['date'] = d.date || todayStr(); if (d.mood) facets['mood'] = d.mood; if (d.people.length) input['people'] = d.people.map((p) => `[[${plainTitle(p)}]]`); }
    if (kind === 'person') { if (d.relation) input['relation'] = d.relation; if (d.birthday) facets['birthday'] = d.birthday; }
    if (kind === 'resource' && url) input['url'] = url;
    if (Object.keys(facets).length) input['facets'] = facets;
    try {
      const res = await api.createNode(input);
      close();
      select(res.node.fm.id);
      setTimeout(() => requestFly([res.node.fm.id]), 600);
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };

  if (!kind) {
    return (
      <div>
        <Title>{t('add.whatKind')}</Title>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ADDABLE_KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} className="kind-pick">
              <span className={`kind-pick-icon k-${k}`}><TypeIcon type={k} size={18} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text">{t(`type.${k}` as TKey)}</span>
                <span className="block text-[11.5px] leading-snug text-muted">{t(`kindHint.${k}` as TKey)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-line bg-panel p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted"><Sparkles size={13} className="text-accent" />{t('add.orJustType')}</div>
          <textarea value={free} onChange={(e) => setFree(e.target.value)} rows={2} placeholder={t('add.justTypePh')} className="w-full resize-none bg-transparent text-sm text-text outline-none placeholder:text-muted" dir={inputDir(free, locale)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void handToBrain(); } }} />
          <div className="flex justify-end"><button onClick={() => void handToBrain()} disabled={!free.trim() || busy} className="btn-primary">{busy && <Loader2 size={14} className="animate-spin" />}{t('add.sendToBrain')}</button></div>
        </div>
      </div>
    );
  }

  const canSubmit = Boolean(d.title.trim() || (kind === 'resource' && d.url.trim()));
  return (
    <div>
      <div className="flex items-center gap-2">
        {!initialKind && <button onClick={() => setKind(null)} className="icon-btn small ghost" aria-label={t('common.back')} title={t('common.back')}><Back size={16} /></button>}
        <span className={`kind-pick-icon small k-${kind}`}><TypeIcon type={kind} size={15} /></span>
        <Title>{t(`type.${kind}` as TKey)}</Title>
      </div>
      <div className="mt-4 space-y-3.5">
        {kind === 'resource' && (
          <div className="relative">
            <input autoFocus value={d.url} onChange={(e) => up({ url: e.target.value })} placeholder={t('add.urlPh')} className="field w-full" dir="ltr" />
            {fetching && <span className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-muted"><Loader2 size={12} className="animate-spin" />{t('add.fetching')}</span>}
          </div>
        )}
        <input autoFocus={kind !== 'resource'} value={d.title} onChange={(e) => up({ title: e.target.value })} placeholder={t(`add.ph.${kind}` as TKey)} className="field w-full text-[15px]" dir={inputDir(d.title, locale)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }} />
        {kind === 'task' && (
          <Row label={t('panel.due')}><DateField value={d.due || undefined} placeholder={t('kind.noDate')} onSave={(v) => up({ due: v ?? '' })} /></Row>
        )}
        {kind === 'task' && projects.length > 0 && (
          <Row label={t('panel.project')}>
            <select className="field-inline" value={d.project} onChange={(e) => up({ project: e.target.value })}>
              <option value="">{t('kind.noProject')}</option>
              {projects.map((p) => <option key={p.id} value={p.title}>{p.title}</option>)}
            </select>
          </Row>
        )}
        {kind === 'project' && <Row label={t('kind.deadline')}><DateField value={d.due || undefined} placeholder={t('kind.noDate')} onSave={(v) => up({ due: v ?? '' })} /></Row>}
        {kind === 'goal' && (
          <>
            <Row label={t('kind.target')}><DateField value={d.target || undefined} placeholder={t('kind.noDate')} onSave={(v) => up({ target: v ?? '' })} /></Row>
            <input value={d.why} onChange={(e) => up({ why: e.target.value })} placeholder={t('kind.whyPh')} className="field w-full" dir={inputDir(d.why, locale)} />
          </>
        )}
        {kind === 'habit' && (
          <>
            <Row label={t('kind.cadence')}><Segmented value={d.cadence} options={CADENCES.map((c) => ({ value: c, label: t(`cadence.${c}` as TKey) }))} onChange={(v) => up({ cadence: v })} /></Row>
            <Row label={t('kind.time')}><Segmented value={d.time} options={TIMES.map((c) => ({ value: c, label: t(`time.${c}` as TKey) }))} onChange={(v) => up({ time: d.time === v ? '' : v })} /></Row>
          </>
        )}
        {kind === 'event' && (
          <>
            <Row label={t('kind.when')}><DateField value={d.date || undefined} placeholder={t('kind.noDate')} onSave={(v) => up({ date: v ?? '' })} /></Row>
            <Row label={t('kind.mood')}><MoodPicker value={d.mood ?? undefined} onChange={(m) => up({ mood: m })} /></Row>
            <Row label={t('kind.with')}><ChipInput values={d.people} onChange={(p) => up({ people: p })} suggestions={people} placeholder={t('panel.addPerson')} /></Row>
          </>
        )}
        {kind === 'person' && (
          <>
            <Row label={t('kind.relation')}><Segmented value={d.relation} options={RELATIONS.map((r) => ({ value: r, label: t(`relation.${r}` as TKey) }))} onChange={(v) => up({ relation: d.relation === v ? '' : v })} /></Row>
            <Row label={t('kind.birthday')}><DateField value={d.birthday || undefined} placeholder={t('kind.noDate')} onSave={(v) => up({ birthday: v ?? '' })} /></Row>
          </>
        )}
        <textarea value={d.details} onChange={(e) => up({ details: e.target.value })} rows={2} placeholder={t('add.details')} className="field w-full resize-none" dir={inputDir(d.details, locale)} />
        <Row label={t('panel.area')}>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="field-inline max-w-[14rem]">
            <option value="">{t('panel.noCategory')}</option>
            {palette.categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Row>
      </div>
      <Actions busy={busy} disabled={!canSubmit} submit={() => void submit()} label={t('add.submit')} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-24 shrink-0 text-[12px] text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function DeleteNode({ id }: { id: string }) {
  const t = useT();
  const close = useStore((s) => s.closeDialog);
  const setToast = useStore((s) => s.setToast);
  const select = useStore((s) => s.select);
  const graph = useStore((s) => s.graph);
  const node = graph?.nodes.find((n) => n.id === id);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.deleteNode(id);
      select(null);
      close();
      const commit = r.commit;
      setToast(t('item.deleted'), commit ? { label: t('settings.undo'), run: () => { void api.undo(commit).then(() => setToast(t('chat.undone'))); } } : undefined);
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <Title>{t('item.deleteTitle')}</Title>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t('item.deleteHint')}</p>
      <p className="mt-3 rounded-xl bg-panel2 px-3 py-2 text-sm text-text"><bdi>{node?.title ?? id}</bdi></p>
      <Actions busy={busy} submit={() => void submit()} label={t('common.delete')} danger />
    </div>
  );
}

function DeleteCategory({ id }: { id: string }) {
  const t = useT();
  const close = useStore((s) => s.closeDialog);
  const setToast = useStore((s) => s.setToast);
  const select = useStore((s) => s.select);
  const openPlace = useStore((s) => s.openPlace);
  const setCategoryPage = useStore((s) => s.setCategoryPage);
  const palette = usePalette();
  const cat = palette.category(id);
  const others = palette.categories.filter((c) => c.id !== id);
  const [moveTo, setMoveTo] = useState<string>(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.deleteCategory(id, moveTo || null);
      select(null);
      openPlace(null);
      setCategoryPage('all');
      close();
      const commit = r.commit;
      setToast(t('category.deleted'), commit ? { label: t('settings.undo'), run: () => { void api.undo(commit).then(() => setToast(t('chat.undone'))); } } : undefined);
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <Title>{t('category.deleteTitle')}</Title>
      <p className="mt-3 rounded-xl bg-panel2 px-3 py-2 text-sm text-text"><bdi>{cat?.title ?? id}</bdi></p>
      <p className="mt-3 text-sm text-muted">{t('category.deleteHint').replace('{n}', String(Math.max(0, (cat?.size ?? 1) - 1)))}</p>
      <label className="mt-3 block">
        <span className="label">{t('category.moveTo')}</span>
        <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="field w-full">
          {others.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          <option value="">{t('category.moveNowhere')}</option>
        </select>
      </label>
      <Actions busy={busy} submit={() => void submit()} label={t('category.delete')} danger />
    </div>
  );
}
