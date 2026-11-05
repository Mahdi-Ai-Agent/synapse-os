export type EngineId = 'claude-cli' | 'codex-cli' | 'anthropic-api' | 'openai-api' | 'openrouter';

/** How an engine authenticates: a vendor CLI the user signed into, or an API key the user supplies. */
export type EngineAuth = 'cli-login' | 'api-key';

/** Providers whose keys the app can store for the API engines. */
export type KeyProvider = 'anthropic' | 'openai' | 'openrouter';

/** Supplies an API key stored outside the environment (the app's settings file); `undefined` = none stored. */
export type KeyLookup = (provider: KeyProvider) => Promise<string | undefined>;

export interface EngineProbe {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  /** Human-readable instruction that makes the engine usable (e.g. how to log in or where to put the key). */
  fix?: string;
  detail?: string;
  /** The account the CLI says it is signed in to (an email and plan, or the vendor's name for it); never a credential. */
  account?: string;
  /** Where the CLI was found: on PATH, or inside the vendor's desktop app (docs/BRAIN-ENGINES.md "On a desktop"). */
  via?: 'path' | 'chatgpt-app' | 'claude-app';
  checkedAt: string;
}

export interface ModelOption {
  id: string;
  label: string;
  /** The efforts this model takes, when they differ between models (the engine's `efforts()` otherwise). */
  efforts?: string[];
  /** The effort the vendor starts this model on. */
  defaultEffort?: string;
}

export interface BrainRunRequest {
  prompt: string;
  /** Working directory for the engine — the vault root. */
  cwd: string;
  model?: string;
  effort?: string;
  /** Engine session to resume (multi-turn threads). */
  sessionId?: string;
  /** Do not persist a vendor CLI session outside the protected vault. */
  ephemeral?: boolean;
  /** File whose contents are appended to the engine's system prompt (the runtime context). */
  systemAppendFile?: string;
  maxTurns?: number;
  /** Let the engine open URLs from the prompt (`claude-cli` adds WebFetch); engines without web access ignore it. */
  allowWeb?: boolean;
}

/** Token counts normalized across engines (the raw provider object stays in `usage`). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type BrainEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; summary: string }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string }
  | { type: 'result'; text: string; sessionId: string; costUsd?: number; usage?: unknown; tokens?: TokenUsage; isError: boolean; numTurns?: number; durationMs?: number }
  | { type: 'error'; message: string }
  /** A passing condition the engine reported while the run goes on (an API retry, a reconnect, a warning): shown, never a failure. */
  | { type: 'notice'; message: string };

/**
 * A vendor CLI's own sign-in, run by the server on a terminal so the user finishes it in the browser
 * (docs/BRAIN-ENGINES.md "Sign-in from the app"). `paste-code`: the CLI prints the vendor's link and waits for the
 * code the vendor's page shows after sign-in. `device-code`: it prints a link and a code to type there, and waits.
 */
export type SignInFlow = 'paste-code' | 'device-code';

export interface SignInSpec {
  flow: SignInFlow;
  /** Arguments of the CLI's own sign-in command. */
  login: string[];
  /** Arguments of its sign-out command. */
  logout: string[];
  /** The vendor's sign-in hosts: a link to any other host is never shown. */
  hosts: string[];
}

export interface BrainEngine {
  readonly id: EngineId;
  readonly name: string;
  readonly auth: EngineAuth;
  /** Environment variable that can supply the key (api-key engines only). */
  readonly keyEnv?: string;
  probe(force?: boolean): Promise<EngineProbe>;
  models(): ModelOption[];
  /** Effort levels; empty when the engine has no effort control. */
  efforts(): string[];
  /** Live model list from the provider when it has one; `models()` stays the static fallback. */
  fetchModels?(): Promise<ModelOption[]>;
  /** How the app signs this CLI in (cli-login engines). */
  readonly signIn?: SignInSpec;
  /** The CLI binary, or null when it is not installed (cli-login engines). */
  resolveBin?(): Promise<string | null>;
  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent>;
}
