import type { EdgeKind, GraphData, GraphEdge, GraphNode, RelatedHit, SearchHit, VaultNode } from '@synapse/core';

export type { EdgeKind, GraphData, GraphEdge, GraphNode, RelatedHit, SearchHit, VaultNode };

export type Locale = 'fa' | 'en';

/** Graph node as drawn: vault nodes, ghosts, client-side tag nodes (`tag:<name>`) when the tags toggle is on, and the mind map's core (`core:mind`). */
export type UiGraphNode = Omit<GraphNode, 'type'> & { type: GraphNode['type'] | 'tag' | 'core' };
export type UiEdgeKind = EdgeKind | 'tag';
export type UiGraphEdge = Omit<GraphEdge, 'kind'> & { kind: UiEdgeKind };
/** Pages of the app shell (docs/UI-DESIGN.md "Shell"); `today` opens the guide; `more` exists on the phone only. */
export type View = 'chat' | 'graph' | 'coach' | 'goals' | 'plan' | 'inbox' | 'me' | 'today' | 'categories' | 'settings' | 'more';
export type BrainMode = 'capture' | 'ask' | 'chat' | 'advise' | 'make' | 'daily' | 'weekly' | 'insight' | 'character' | 'review';
/** What a message in the composer asks of the brain (UI-DESIGN "Chat"). */
export type ChatMode = 'chat' | 'advise' | 'make';
/** The coach's old tabs, each now a page (UI-DESIGN "Guide"). */
export type CoachTab = 'now' | 'plan' | 'inbox' | 'me';

export interface NodeDetail {
  node: VaultNode;
  backlinks: Array<{ id: string; title: string; type: string; summary: string }>;
  outgoing: Array<{ target: string; kind: string; resolved: boolean; text: string; title: string | null; type: string | null }>;
}

export interface EngineDefaults { model?: string; effort?: string }

export interface Settings {
  engine: string;
  /** Model/effort of the selected engine (mirrors `engines[engine]`). */
  model: string;
  effort: string;
  locale: Locale;
  graph: { showDone: boolean; showTags: boolean; mode: '2d' | '3d' };
  engines: Record<string, EngineDefaults>;
  /** Stored API keys, masked by the server (`sk-ant-…cdef`). */
  apiKeys: Record<string, string>;
  /** `lanAccess`: the server binds all interfaces so a paired phone can reach it. */
  server: { lanAccess: boolean };
  /** Scheduled reviews (ARCHITECTURE "Automation"): the daily plan at `HH:mm`, the weekly review on a weekday; null = off. */
  automation: { review: string | null; daily: string | null; weekly: { day: number; time: string } | null };
}

/** What `PUT /api/settings` accepts: a `null` key removes it. */
export type SettingsPatch = Partial<Omit<Settings, 'graph' | 'engines' | 'apiKeys' | 'server' | 'automation'>> & {
  graph?: Partial<Settings['graph']>;
  engines?: Record<string, EngineDefaults>;
  apiKeys?: Record<string, string | null>;
  server?: Partial<Settings['server']>;
  automation?: Partial<Settings['automation']>;
};

/** `GET /api/pairing`: the token and pair URLs are present only for loopback (desktop) clients. */
/** `GET /api/diagnostics` (docs/ARCHITECTURE.md "Diagnostics"). */
export interface ServerDiagnostics {
  startedAt: string;
  node: string;
  platform: string;
  trustLoopback: boolean;
  live: { websocketClients: number; lastSeq: number; epoch: string };
  busy: boolean;
  engines: Array<{ id: string; installed: boolean; loggedIn: boolean; version: string | null; selected: boolean }>;
  errors: Array<{ at: string; code: string; message: string; requestId?: string; path?: string }>;
}

/** `GET /api/auth/status` (docs/ARCHITECTURE.md "Access control"). */
/** An app connected over MCP, or a personal key (docs/ARCHITECTURE.md "MCP connector"). */
export interface ConnectionInfo {
  id: string;
  kind: 'oauth' | 'key';
  name: string;
  /** Where the app lives: `claude.ai`, `chatgpt.com`, `localhost`, or `key`. */
  via: string;
  write: boolean;
  createdAt: string;
  usedAt: string | null;
  hint?: string;
}

export interface ConnectionsList {
  /** This server's MCP address as the browser reached it. */
  mcpUrl: string;
  connections: ConnectionInfo[];
}

/** What the consent page shows: which app asks, where the answer goes, whether it asked to write. */
export interface ConsentRequest {
  app: string;
  returnsTo: string;
  /** The answer goes to an app on the computer that opened the page (a loopback redirect). */
  local: boolean;
  write: boolean;
  owner: string | null;
}

export interface AuthStatus {
  account: boolean;
  authenticated: boolean;
  /** This client is signed in with the account (it can sign out). */
  session: boolean;
  username: string | null;
  /** The first-run setup needs the code from the server log. */
  needsCode: boolean;
}

export interface PairingInfo {
  lanAccess: boolean;
  bound: { host: string; lan: boolean; pinned: boolean } | null;
  port: number;
  urls: string[];
  fromLoopback: boolean;
  token: string | null;
  createdAt: string | null;
  pairUrls: string[];
}

export interface VaultInfo {
  exists: boolean;
  path: string;
  stats: Record<string, unknown>;
  settings: Settings;
  busy: boolean;
}

export interface TokenUsage { input: number; output: number; cacheRead?: number; cacheWrite?: number }

export interface EngineInfo {
  id: string;
  name: string;
  auth: 'cli-login' | 'api-key';
  keyEnv: string | null;
  key: { source: 'settings' | 'env'; masked: string } | null;
  /** `account`: who the CLI is signed in as; `via`: where it was found (on PATH, or inside the ChatGPT or Claude app). */
  probe: { installed: boolean; loggedIn: boolean; version?: string; fix?: string; detail?: string; account?: string; via?: 'path' | 'chatgpt-app' | 'claude-app'; checkedAt: string };
  /** A model's own efforts when they differ between models (Codex), else the engine's `efforts`. */
  models: Array<{ id: string; label: string; efforts?: string[]; defaultEffort?: string }>;
  efforts: string[];
  canFetchModels: boolean;
  /** The app can run this CLI's own sign-in (`paste-code`: Claude, `device-code`: ChatGPT). */
  signIn: 'paste-code' | 'device-code' | null;
  defaults: { model: string; effort: string };
  selected: boolean;
}

/** A CLI sign-in run by the server (`/api/engines/:id/sign-in`, docs/ARCHITECTURE.md). */
export interface SignInState {
  engine: string;
  flow: 'paste-code' | 'device-code';
  status: 'starting' | 'waiting' | 'verifying' | 'done' | 'failed' | 'cancelled';
  url: string | null;
  code: string | null;
  needsPaste: boolean;
  message: string | null;
  startedAt: string;
}

export type BrainEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; summary: string }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string }
  | { type: 'result'; text: string; sessionId: string; costUsd?: number; tokens?: TokenUsage; isError: boolean; numTurns?: number; durationMs?: number }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string };

/** `GET /api/preview`: what a saved link looks like (Open Graph / oEmbed), cached by the server. */
export interface LinkPreview { url: string; title?: string; description?: string; image?: string; site?: string; platform: string; kind: string; fetchedAt: string; ok: boolean }

/** `GET /api/layout`: where the user left the graph (.synapse/layout.json); `rev` counts its saves (docs/ARCHITECTURE.md "Layout"). */
export type LayoutPoint = [number, number, number];
export interface SavedLayout { anchors: Record<string, LayoutPoint>; pins: Record<string, LayoutPoint>; positions: Record<string, LayoutPoint>; room?: Record<string, number>; settled?: boolean; savedAt: string; rev?: number }
/** `POST /api/import`: what the export holds (`check`), or what replaced the data here. */
export interface ImportAnswer {
  ok: boolean;
  check?: boolean;
  exportedAt: string;
  counts: { items: number; memory: number; chats: number };
  commit?: string | null;
  safetyCopy?: string;
}
/** `PUT /api/layout`: the map as one open copy of the app has it, the `rev` it was based on, and which copy sends it. */
export interface LayoutSave { anchors: Record<string, LayoutPoint>; pins: Record<string, LayoutPoint>; positions: Record<string, LayoutPoint>; room: Record<string, number>; settled?: boolean; base: number; client: string }
/** Its answer: written (`rev`), or `stale` — based on an older layout than the server has, so not written. */
export interface LayoutSaveAnswer { ok: boolean; stale?: boolean; rev?: number; savedAt?: string }

export interface NodeChanges {
  created: string[];
  updated: string[];
  deleted: string[];
  commit?: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'brain';
  text: string;
  /** Shown instead of `text` when the app wrote the prompt (inbox filing, reviews). */
  display?: string;
  at: string;
  mode?: BrainMode;
  runId?: string;
  changes?: NodeChanges;
  costUsd?: number;
  tokens?: TokenUsage;
  isError?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  engineSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface Commit {
  hash: string;
  date: string;
  subject: string;
}

/** `POST /api/brain/run` response: `position` = runs ahead of this one when it was enqueued (0 = starts now). */
export interface RunStart { runId: string; threadId: string; queued: boolean; position: number }

/** The server's run queue (`brain.queue` event): the running run and the waiting ones in order. */
export interface BrainQueue { running: string | null; queued: string[] }

export type InboxFileStatus = 'queued' | 'running' | 'filed' | 'failed';

/** Filing state of one inbox item, keyed by its vault path in the store; an idle item has no entry. */
export interface InboxFileState {
  status: InboxFileStatus;
  nodeId: string;
  /** Cached so the row survives the brain deleting the file mid-run. */
  title: string;
  created: string | null;
  runId?: string;
  threadId?: string;
  /** Runs ahead of this one when it was enqueued. */
  position?: number;
  error?: string;
}

/** "File all" progress: the items in order, the index of the one being filed now, and the thread they share. */
export interface InboxBatch { paths: string[]; index: number; threadId?: string }

export interface RunLive {
  runId: string;
  threadId: string;
  mode: BrainMode;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  /** Runs ahead of this one when it was enqueued (from the run response); the live queue supersedes it. */
  position?: number;
  text: string;
  tools: Array<{ id: string; summary: string; ok?: boolean }>;
  /** The engine's latest notice (an API retry, a reconnect), shown while it waits; cleared by its next output. */
  notice?: string;
  changes?: NodeChanges;
  error?: string;
  costUsd?: number;
  tokens?: TokenUsage;
}
