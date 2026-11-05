/**
 * What the Mac app offers its page (apps/desktop/src/preload.ts; docs/ARCHITECTURE.md "Desktop protection"); null in a
 * browser. Before the app locks it asks the page to save what is being typed; `onBeforeLock` registers such a saver.
 */
interface DesktopBridge {
  onLocking?: (save: () => Promise<void>) => void;
  confirmExport?: () => Promise<boolean>;
  setTheme?: (theme: 'dark' | 'light') => void;
}

export function desktop(): DesktopBridge | null {
  const w = globalThis as unknown as { synapseDesktop?: DesktopBridge };
  return w.synapseDesktop ?? null;
}

const savers = new Set<() => Promise<void>>();

/** Registers something to save before the Mac app locks; returns the unregister. */
export function onBeforeLock(save: () => Promise<void>): () => void {
  savers.add(save);
  return () => { savers.delete(save); };
}

/** Called once at start: the app's lock waits (briefly) for every saver. */
export function installLockSaving(): void {
  desktop()?.onLocking?.(async () => { await Promise.allSettled([...savers].map((s) => s())); });
}

/** In the Mac app an unencrypted export is confirmed first (it leaves the encrypted disk); a browser just goes on. */
export async function confirmExport(): Promise<boolean> {
  const fn = desktop()?.confirmExport;
  return fn ? fn() : true;
}
