import { create } from 'zustand';
import type { MapNames, SpreadMode } from '../graph/engine';
import type { ColorDraft } from '../graph/model';
import { rectOf, type Rect } from '../lib/floating';
import type { LiveStatus } from '../lib/ws';
import type { BrainQueue, ChatMode, CoachTab, EngineInfo, GraphData, InboxBatch, InboxFileState, Locale, NodeChanges, RunLive, Settings, Thread, ThreadSummary, VaultInfo, View } from '../lib/types';
import { applyTheme, storedTheme, type Theme } from '../lib/theme';

export interface Filters {
  hiddenTypes: Set<string>;
  /** Finished items (done, achieved) stay on the map, faded, unless switched off. */
  showDone: boolean;
  /** Archived and dropped items are out of sight unless switched on (UI-DESIGN "Done and archived"). */
  showArchived: boolean;
  orphansOnly: boolean;
  tag: string | null;
  query: string;
  /** Maps taken off the canvas for now (UI-DESIGN "Maps"); their connections are vault data, not a filter. */
  hiddenMaps: Set<string>;
}

/** Modal dialogs: create/edit a category, a new map, add an item, confirm a delete. */
export type DialogState =
  | { kind: 'category'; editId?: string; /** Title of the map a new category goes into (UI-DESIGN "Maps"). */ map?: string }
  | { kind: 'map' }
  | { kind: 'add'; type?: string; category?: string; title?: string }
  | { kind: 'delete'; id: string }
  | { kind: 'deleteCategory'; id: string };

export interface Highlight {
  created: Set<string>;
  updated: Set<string>;
  until: number;
}

const VIEWS: readonly View[] = ['chat', 'graph', 'coach', 'goals', 'plan', 'inbox', 'me', 'today', 'categories', 'settings', 'more'];

/** A model/effort choice for this device (UI-DESIGN "Chat": the brain picker). */
export interface Choice { engine: string; model: string; effort: string }
const isChoice = (v: unknown): v is Choice => typeof v === 'object' && v !== null && typeof (v as Choice).engine === 'string' && typeof (v as Choice).model === 'string' && typeof (v as Choice).effort === 'string';

/** The names switch's steps, in the order a press goes through them (UI-DESIGN "Map-style labels"). */
export const MAP_NAMES: readonly MapNames[] = ['all', 'places', 'none'];

function stored<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch { return fallback; }
}
function store(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep it in memory only */ }
}

interface State {
  locale: Locale;
  view: View;
  vault: VaultInfo | null;
  graph: GraphData | null;
  /** The item whose details are open (map: start-side panel; other pages: end-side panel; phone: a sheet). */
  selectedId: string | null;
  /** The category whose card is open on the map (a click on a region, its name or its centre). */
  placeGroup: string | null;
  /** Place open on the places page: `all` (the list), a category id, `MIND`, `MAP_PLACE` + a map id or a special place (`lib/places.ts`). */
  categoryPage: string;
  focusId: string | null;
  focusDepth: number;
  filters: Filters;
  mode3d: boolean;
  /** Which names the map shows (the toolbar's names switch, UI-DESIGN "Map-style labels"), remembered per device. */
  mapNames: MapNames;
  /** Dark or light, per device (UI-DESIGN "Light theme"). */
  theme: Theme;
  /** The colour being picked for a category or a map (UI-DESIGN "Colour"): drawn at once, dropped once the vault has it. */
  colorDraft: ColorDraft | null;
  /** The map's spread tool is on (UI-DESIGN "Mind map" → Spreading); this session only. */
  spreadTool: SpreadMode | null;
  /** The conversation panel on the map: open or not, and where the user put it (null: above the tell bar). Per device. */
  mapChat: { open: boolean; rect: Rect | null };
  timelapse: { playing: boolean; cutoff: number };
  highlight: Highlight | null;
  engines: EngineInfo[];
  /** Where the brain runs: on the owner's own computer, or on a server (`/api/engines` `place`). */
  enginePlace: 'desktop' | 'server';
  settings: Settings | null;
  thread: Thread | null;
  threads: ThreadSummary[];
  run: RunLive | null;
  /** The server's run queue, kept current by `brain.queue` events. */
  queue: BrainQueue;
  /** Per-inbox-item filing state keyed by vault path (`state/inbox-filing.ts` drives it). */
  inboxFiling: Record<string, InboxFileState>;
  inboxBatch: InboxBatch | null;
  /** The live channel (`lib/ws.ts`): how events arrive, or why they do not. */
  live: LiveStatus;
  toast: string | null;
  /** Optional button on the toast (e.g. Undo after a delete). */
  toastAction: { label: string; run: () => void } | null;
  /** The server answered 401: this device must pair again (docs/ARCHITECTURE.md "Access control"). */
  unauthorized: boolean;
  /** Region kept lit on the map while the others fade (its card is open, or a chip is picked). */
  isolateGroup: string | null;
  /** Bumped to ask the map to frame these item ids (search hits, a category, new items) or a map's island. */
  flyRequest: { ids: string[]; group?: string; map?: string; at: number } | null;
  dialog: DialogState | null;
  sidebarCollapsed: boolean;
  /** The past-chats column inside the chat page (desktop), remembered per device. */
  chatHistoryOpen: boolean;
  /** What the composer does with a message: file and answer (`chat`), think it through (`advise`), or make something (`make`). */
  chatMode: ChatMode;
  /** The scope the next run works in (UI-DESIGN "Scopes"): `mind` for the core, or the id of a map cut off from the mind map. */
  scope: string;
  /** The coach's old tabs, now pages (UI-DESIGN "Guide"); kept so a tab asked for opens its page. */
  coachTab: CoachTab;
  /** Bumped to put the cursor in the chat composer (new chat, a suggestion). */
  composerFocusAt: number;
  /** Engine, model and effort picked for this device (empty = the defaults in Settings). */
  choice: Choice;

  setLocale(l: Locale): void;
  setView(v: View): void;
  setVault(v: VaultInfo | null): void;
  setGraph(g: GraphData | null): void;
  select(id: string | null): void;
  openPlace(group: string | null): void;
  setCategoryPage(id: string): void;
  setFocus(id: string | null, depth?: number): void;
  setFilters(p: Partial<Filters>): void;
  toggleType(type: string): void;
  setMode3d(v: boolean): void;
  setMapNames(v: MapNames): void;
  setTheme(theme: Theme): void;
  setColorDraft(d: ColorDraft | null): void;
  setSpreadTool(v: SpreadMode | null): void;
  setMapChat(patch: Partial<{ open: boolean; rect: Rect | null }>): void;
  setTimelapse(p: Partial<{ playing: boolean; cutoff: number }>): void;
  setHighlight(c: NodeChanges | null): void;
  setEngines(e: EngineInfo[], place?: 'desktop' | 'server'): void;
  setSettings(s: Settings | null): void;
  setThread(t: Thread | null): void;
  setThreads(t: ThreadSummary[]): void;
  setRun(r: RunLive | null | ((prev: RunLive | null) => RunLive | null)): void;
  setQueue(q: BrainQueue): void;
  patchInboxFiling(p: Record<string, InboxFileState>): void;
  removeInboxFiling(paths: string[]): void;
  setInboxBatch(b: InboxBatch | null): void;
  setLive(v: LiveStatus): void;
  setToast(m: string | null, action?: { label: string; run: () => void }): void;
  setUnauthorized(v: boolean): void;
  setIsolateGroup(g: string | null): void;
  requestFly(ids: string[], group?: string, map?: string): void;
  openDialog(d: DialogState): void;
  closeDialog(): void;
  setSidebarCollapsed(v: boolean): void;
  setChatHistoryOpen(v: boolean): void;
  setChatMode(m: ChatMode): void;
  setScope(id: string): void;
  toggleMap(id: string): void;
  setCoachTab(tab: CoachTab): void;
  /** Shows the chat page (a run started elsewhere streams there). */
  revealChat(): void;
  focusComposer(): void;
  setChoice(c: Partial<Choice>): void;
}

export const useStore = create<State>((set, get) => ({
  locale: 'fa',
  view: stored<View>('synapse.view', 'chat', (v): v is View => typeof v === 'string' && (VIEWS as readonly string[]).includes(v) && v !== 'more'),
  vault: null,
  graph: null,
  selectedId: null,
  placeGroup: null,
  categoryPage: 'all',
  focusId: null,
  focusDepth: 1,
  filters: { hiddenTypes: new Set<string>(), showDone: true, showArchived: true, orphansOnly: false, tag: null, query: '', hiddenMaps: new Set<string>() },
  mode3d: false,
  // `true` / `false` were stored before the switch had its third step (no names at all).
  theme: storedTheme(),
  mapNames: ((v) => (v === false ? 'places' : MAP_NAMES.includes(v as MapNames) ? (v as MapNames) : 'all'))(stored<unknown>('synapse.mapNames', 'all', (v): v is unknown => v !== undefined)),
  colorDraft: null,
  spreadTool: null,
  mapChat: ((v) => ({ open: v !== null && typeof v === 'object' && (v as { open?: unknown }).open === true, rect: rectOf(v && typeof v === 'object' ? (v as { rect?: unknown }).rect : null) }))(stored<unknown>('synapse.mapChat', null, (v): v is unknown => v !== undefined)),
  timelapse: { playing: false, cutoff: 1 },
  highlight: null,
  engines: [],
  enginePlace: 'server',
  settings: null,
  thread: null,
  threads: [],
  run: null,
  queue: { running: null, queued: [] },
  inboxFiling: {},
  inboxBatch: null,
  live: { mode: 'connecting', code: null, detail: null },
  toast: null,
  toastAction: null,
  unauthorized: false,
  isolateGroup: null,
  flyRequest: null,
  dialog: null,
  sidebarCollapsed: stored('synapse.sidebarCollapsed', false, (v): v is boolean => typeof v === 'boolean'),
  chatHistoryOpen: stored('synapse.chatHistory', true, (v): v is boolean => typeof v === 'boolean'),
  chatMode: 'chat',
  scope: 'mind',
  coachTab: 'now',
  composerFocusAt: 0,
  choice: stored<Choice>('synapse.choice', { engine: '', model: '', effort: '' }, isChoice),

  setLocale: (locale) => set({ locale }),
  setView: (wanted) => {
    // "Today" is the guide (UI-DESIGN "Guide"); the plan, the inbox and "me" are pages of their own.
    const view: View = wanted === 'today' ? 'coach' : wanted;
    const tab: Partial<Pick<State, 'coachTab'>> = {};
    if (view !== 'more') store('synapse.view', view);
    // Moving between pages keeps the conversation (UI-DESIGN "Chat"): only New chat starts another one.
    set((s) => ({ view, ...tab, selectedId: view === s.view ? s.selectedId : null, ...(view !== 'graph' ? { placeGroup: null, isolateGroup: null } : {}) }));
  },
  setVault: (vault) => set({ vault }),
  // A filed inbox item leaves the list once the refreshed graph no longer has its file.
  setGraph: (graph) => set((s) => {
    if (!graph) return { graph };
    const present = new Set(graph.nodes.map((n) => n.path));
    const kept = Object.fromEntries(Object.entries(s.inboxFiling).filter(([p, st]) => st.status !== 'filed' || present.has(p)));
    const ids = new Set(graph.nodes.map((n) => n.id));
    const gone = s.selectedId && !s.selectedId.startsWith('ghost:') && !ids.has(s.selectedId) ? { selectedId: null } : {};
    const placeGone = s.placeGroup && !graph.categories.some((c) => c.id === s.placeGroup) && !s.placeGroup.startsWith('__') ? { placeGroup: null, isolateGroup: null } : {};
    // A picked colour stops being a draft once the vault has it (or its category or map is gone).
    const d = s.colorDraft;
    const holder = d?.saved ? (graph.categories.find((c) => c.id === d.id) ?? graph.maps.find((m) => m.id === d.id)) : undefined;
    const settled = d?.saved && (!holder || holder.color === d.color) ? { colorDraft: null } : {};
    return { graph, ...gone, ...placeGone, ...settled, ...(Object.keys(kept).length === Object.keys(s.inboxFiling).length ? {} : { inboxFiling: kept }) };
  }),
  select: (selectedId) => set({ selectedId }),
  openPlace: (placeGroup) => set({ placeGroup, isolateGroup: placeGroup, selectedId: null }),
  setCategoryPage: (categoryPage) => set({ categoryPage }),
  setFocus: (focusId, depth) => set((s) => ({ focusId, focusDepth: depth ?? (s.focusDepth || 1) })),
  setFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  toggleType: (type) => set((s) => {
    const hidden = new Set(s.filters.hiddenTypes);
    if (hidden.has(type)) hidden.delete(type); else hidden.add(type);
    return { filters: { ...s.filters, hiddenTypes: hidden } };
  }),
  setMode3d: (mode3d) => set({ mode3d }),
  setMapNames: (mapNames) => { store('synapse.mapNames', mapNames); set({ mapNames }); },
  setTheme: (theme) => { store('synapse.theme', theme); applyTheme(theme); set({ theme }); },
  setColorDraft: (colorDraft) => set({ colorDraft }),
  setSpreadTool: (spreadTool) => set({ spreadTool }),
  setMapChat: (patch) => set((s) => { const mapChat = { ...s.mapChat, ...patch }; store('synapse.mapChat', mapChat); return { mapChat }; }),
  setTimelapse: (p) => set((s) => ({ timelapse: { ...s.timelapse, ...p } })),
  setHighlight: (c) => set({ highlight: c ? { created: new Set(c.created), updated: new Set(c.updated), until: Date.now() + 15_000 } : null }),
  setEngines: (engines, place) => set(place ? { engines, enginePlace: place } : { engines }),
  setSettings: (settings) => set({ settings }),
  // The open conversation is remembered on this device, so the app opens on it again.
  setThread: (thread) => { store('synapse.thread', thread?.id ?? null); set({ thread }); },
  setThreads: (threads) => set({ threads }),
  setRun: (r) => set((s) => ({ run: typeof r === 'function' ? r(s.run) : r })),
  setQueue: (queue) => set({ queue }),
  patchInboxFiling: (p) => set((s) => ({ inboxFiling: { ...s.inboxFiling, ...p } })),
  removeInboxFiling: (paths) => set((s) => {
    const next = { ...s.inboxFiling };
    for (const p of paths) delete next[p];
    return { inboxFiling: next };
  }),
  setInboxBatch: (inboxBatch) => set({ inboxBatch }),
  setLive: (live) => set({ live }),
  setToast: (toast, action) => set({ toast, toastAction: action ?? null }),
  setUnauthorized: (unauthorized) => set({ unauthorized }),
  setIsolateGroup: (isolateGroup) => set({ isolateGroup }),
  requestFly: (ids, group, map) => set({ flyRequest: { ids, ...(group ? { group } : {}), ...(map ? { map } : {}), at: Date.now() } }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setSidebarCollapsed: (sidebarCollapsed) => { store('synapse.sidebarCollapsed', sidebarCollapsed); set({ sidebarCollapsed }); },
  setChatHistoryOpen: (chatHistoryOpen) => { store('synapse.chatHistory', chatHistoryOpen); set({ chatHistoryOpen }); },
  setChatMode: (chatMode) => set({ chatMode }),
  setScope: (scope) => set({ scope }),
  toggleMap: (id) => set((s) => {
    const hidden = new Set(s.filters.hiddenMaps);
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    return { filters: { ...s.filters, hiddenMaps: hidden } };
  }),
  // The coach's old tabs are pages now: a tab still asked for opens its page.
  setCoachTab: (coachTab) => { get().setView(coachTab === 'now' ? 'coach' : coachTab); set({ coachTab }); },
  revealChat: () => { store('synapse.view', 'chat'); set({ view: 'chat', selectedId: null, placeGroup: null, isolateGroup: null }); },
  focusComposer: () => set({ composerFocusAt: Date.now() }),
  setChoice: (c) => set((s) => { const choice = { ...s.choice, ...c }; store('synapse.choice', choice); return { choice }; }),
}));

/** Runs ahead of `runId` in the server queue: 0 while it runs, null when the queue does not list it. */
export function queuePosition(queue: BrainQueue, runId: string): number | null {
  if (queue.running === runId) return 0;
  const idx = queue.queued.indexOf(runId);
  return idx < 0 ? null : idx + (queue.running ? 1 : 0);
}

/** The conversation that was open when the app was last left on this device, if any. */
export function lastThreadId(): string | null {
  return stored<string | null>('synapse.thread', null, (v): v is string | null => v === null || typeof v === 'string');
}
