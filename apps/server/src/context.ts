import type { BrainEngine, EngineId } from '@synapse/brain';
import type { AuthStore } from './auth';
import type { CliSignIns } from './cli-sign-in';
import type { ConnectionsStore } from './connections';
import type { ServerDiagnostics } from './diagnostics';
import type { BrainRunner } from './brain-runner';
import type { LayoutStore } from './layout-store';
import type { LinkPreviewer } from './link-preview';
import type { ServerConfig } from './config';
import type { PairingStore } from './pairing';
import type { SettingsStore } from './settings';
import type { SuggestionsStore } from './suggestions';
import type { VaultGit } from './vault-git';
import type { VaultService } from './vault-service';
import type { Broadcaster } from './ws';

/** The live TCP binding (set by `startListening`); absent under `inject` in tests. */
export interface Listener {
  readonly host: string;
  readonly port: number;
  /** Bound to all interfaces, i.e. reachable from the LAN. */
  readonly lan: boolean;
  /** `SYNAPSE_HOST` was set: the setting is stored but cannot change the binding. */
  readonly pinned: boolean;
  /** Re-binds to all interfaces or loopback; resolves once the new listener accepts connections. */
  setLanAccess(on: boolean): Promise<void>;
}

export interface Ctx {
  config: ServerConfig;
  vault: VaultService;
  git: VaultGit;
  settings: SettingsStore;
  suggestions: SuggestionsStore;
  pairing: PairingStore;
  auth: AuthStore;
  /** Apps connected over MCP and the personal keys (docs/ARCHITECTURE.md "MCP connector"). */
  connections: ConnectionsStore;
  layout: LayoutStore;
  previews: LinkPreviewer;
  engines: Map<EngineId, BrainEngine>;
  signIns: CliSignIns;
  runner: BrainRunner;
  bus: Broadcaster;
  diag: ServerDiagnostics;
  listener: Listener | null;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
