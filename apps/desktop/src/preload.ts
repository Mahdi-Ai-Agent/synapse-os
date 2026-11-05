/**
 * What the Mac app tells its pages (docs/ARCHITECTURE.md "Desktop app"). The web app reads `speech` to hide the
 * microphone: Electron has the Web Speech API's names but no speech service behind them, and macOS's own recognizer
 * has no Persian. The start page reads the server's state and asks for a retry.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('synapseDesktop', {
  unlock: (value: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:unlock', value),
  platform: process.platform,
  speech: false,
  state: (): Promise<unknown> => ipcRenderer.invoke('desktop:state'),
  onState: (cb: (state: unknown) => void): void => {
    ipcRenderer.on('desktop:state', (_event, state: unknown) => cb(state));
  },
  /** The app page: called before the lock page replaces it; resolve once drafts are saved. */
  onLocking: (save: () => Promise<void>): void => {
    ipcRenderer.on('desktop:locking', () => { void save().catch(() => undefined).finally(() => ipcRenderer.send('desktop:saved')); });
  },
  /** The page's theme: the window and the lock page follow it (docs/UI-DESIGN.md "Light theme"). */
  setTheme: (theme: unknown): void => ipcRenderer.send('desktop:theme', theme),
  /** Asks before an unencrypted export leaves the app; true = go ahead. */
  confirmExport: (): Promise<boolean> => ipcRenderer.invoke('desktop:confirm-export') as Promise<boolean>,
  retry: (): void => ipcRenderer.send('desktop:retry'),
  openLog: (): void => ipcRenderer.send('desktop:open-log'),
});
