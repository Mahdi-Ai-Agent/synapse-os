/**
 * Synapse as a Mac app (docs/ARCHITECTURE.md "Desktop app"). The main process keeps one window on the app's own
 * server, which runs in a utility process from the bundled server (`server/server.mjs` in the app's Resources) on
 * 127.0.0.1:4417 with the vault in ~/Library/Application Support/Synapse/vault. Closing the window keeps the app and
 * its server running (the Dock icon brings the window back); Quit stops both. A server that stops by itself is
 * started again, a page that crashes is loaded again. The brain is the Mac's own Claude Code / ChatGPT (Codex) CLIs,
 * found on the login shell's PATH.
 */
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, type WriteStream } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, screen, session, shell, systemPreferences, utilityProcess,
  type ContextMenuParams, type MenuItemConstructorOptions, type UtilityProcess,
} from 'electron';
import { SecureVault, VaultError, type UnlockResult } from './secure-vault';
import {
  fitBounds, isAppUrl, isExternalUrl, mergePath, parseShellPath, passwordDue, recentStops, restartDelay, serverEnv, SHELL_PATH_MARK,
  windowStateOf, type WindowState,
} from './shell';
import { isLocale, STRINGS, LOCK_STRINGS, type Locale } from './strings';

const PORT = Number(process.env['SYNAPSE_DESKTOP_PORT'] ?? 4417);
const APP_URL = `http://127.0.0.1:${PORT}/`;
app.setName('Synapse');
// A test or a second copy points the app elsewhere with SYNAPSE_DESKTOP_DATA; the owner's data is in Application Support.
const OTHER_DATA = process.env['SYNAPSE_DESKTOP_DATA'];
const DATA = OTHER_DATA ?? path.join(app.getPath('appData'), 'Synapse');
mkdirSync(path.join(DATA, 'shell-protected-v2'), { recursive: true, mode: 0o700 });
app.setPath('userData', path.join(DATA, 'shell-protected-v2'));
let VAULT = path.join(DATA, 'vault');
const LOG_DIR = path.join(DATA, 'private-volume', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const STATE_FILE = path.join(DATA, 'shell-protected-v2', 'window.json');
/** What the shell itself notes while the vault is locked (no data, only what happened), outside the encrypted disk. */
const SHELL_LOG = path.join(DATA, 'shell-protected-v2', 'shell.log');
/** The page's session: kept on disk so the per-device choices survive a restart; everything else is cleared at lock. */
const PARTITION = 'persist:synapse-private';
// Packed, the server, the web UI and the template sit in Resources; unpacked (`pnpm start`) beside this file.
const RES = app.isPackaged ? process.resourcesPath : __dirname;
const MIN = { width: 880, height: 600 };

const secure = new SecureVault(DATA, {
  wrap: async (key) => {
    if (!systemPreferences.canPromptTouchID()) throw new Error('Touch ID is unavailable.');
    return safeStorage.encryptStringAsync(key.toString('base64'));
  },
  unwrap: async (cipher) => {
    await systemPreferences.promptTouchID('unlock Synapse');
    const value = await safeStorage.decryptStringAsync(cipher);
    return Buffer.from(value.result, 'base64');
  },
}, OTHER_DATA ? path.join(DATA, 'logs') : app.getPath('logs'));
let unlocked = false;
let authPending = false;
let lockRequested = false;
let lockPromise: Promise<void> | null = null;
let configured = false;
let biometric = false;
let autoTouchId = true;
let autoRequestId = 1;
let started = false;
/** A lock asked for while the brain works (window closed, screen locked, sleep): it happens once the run ends. */
let lockWhenIdle: number | null = null;
let lockReason: 'close' | 'screen' | 'sleep' | 'menu' = 'close';
let passwordAt: string | undefined;
type Phase = 'locked' | 'starting' | 'ready' | 'port' | 'failed';
let phase: Phase = 'locked';
let failure = '';
let server: UtilityProcess | null = null;
let stops: number[] = [];
let busy = false;
let quitting = false;
let win: BrowserWindow | null = null;
let env: Record<string, string> | null = null;
let log: WriteStream | null = null;

interface ShellState { window: WindowState | null; locale: Locale; theme: 'dark' | 'light' }
function readShellState(): ShellState {
  try {
    const v = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, unknown>;
    return { window: windowStateOf(v['window']), locale: isLocale(v['locale']) ? v['locale'] : 'fa', theme: v['theme'] === 'light' ? 'light' : 'dark' };
  } catch {
    return { window: null, locale: 'fa', theme: 'dark' };
  }
}
function writeShellState(patch: Partial<ShellState>): void {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...readShellState(), ...patch }));
  } catch { /* the next start opens centred and in Persian */ }
}
let locale: Locale = readShellState().locale;

function openLog(): WriteStream {
  mkdirSync(LOG_DIR, { recursive: true });
  try {
    if (statSync(LOG_FILE).size > 5 * 1024 * 1024) renameSync(LOG_FILE, path.join(LOG_DIR, 'server.old.log'));
  } catch { /* no log yet */ }
  return createWriteStream(LOG_FILE, { flags: 'a' });
}
function note(message: string): void {
  const line = `${new Date().toISOString()} [app] ${message}\n`;
  if (unlocked) { (log ??= openLog()).write(line); return; }
  try {
    mkdirSync(path.dirname(SHELL_LOG), { recursive: true });
    if ((statSync(SHELL_LOG, { throwIfNoEntry: false })?.size ?? 0) > 1024 * 1024) renameSync(SHELL_LOG, `${SHELL_LOG}.old`);
    appendFileSync(SHELL_LOG, line, { mode: 0o600 });
  } catch { /* nothing to note it in */ }
}
function tail(lines = 40): string {
  try { return readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The PATH a terminal would have: the login shell prints it (its startup files may print more around it). */
function loginShellPath(): Promise<string | null> {
  const sh = process.env['SHELL'] || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(sh, ['-ilc', `printf '${SHELL_PATH_MARK}%s${SHELL_PATH_MARK}' "$PATH"`], { timeout: 6000, encoding: 'utf8', env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => resolve(parseShellPath(String(stdout ?? ''))));
  });
}

function portTaken(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: PORT });
    const done = (taken: boolean): void => { socket.destroy(); resolve(taken); };
    socket.once('connect', () => done(true)).once('error', () => done(false)).setTimeout(1500, () => done(false));
  });
}

async function health(): Promise<{ busy?: boolean } | null> {
  try {
    const r = await fetch(`${APP_URL}api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as { busy?: boolean }) : null;
  } catch {
    return null;
  }
}

/** The UI language the owner chose (the vault's settings), remembered for the start page and the quit dialog. */
async function learnLocale(): Promise<void> {
  try {
    const r = await fetch(`${APP_URL}api/vault`, { signal: AbortSignal.timeout(3000) });
    const v = (await r.json()) as { settings?: { locale?: unknown } };
    const next = v.settings?.locale;
    if (isLocale(next) && next !== locale) { locale = next; writeShellState({ locale }); }
  } catch { /* keep the last one */ }
}

async function startServer(): Promise<void> {
  if (server || quitting || !unlocked) return;
  setPhase('starting');
  if (await portTaken()) { note(`port ${PORT} is taken by another program`); setPhase('port'); return; }
  env ??= serverEnv({
    base: process.env, path: mergePath(await loginShellPath(), process.env['PATH'], os.homedir()), user: os.userInfo().username,
    vault: VAULT, port: PORT, webDist: path.join(RES, 'web'), envFile: path.join(secure.mount, 'synapse.env'), protected: true,
  });
  if (!unlocked || quitting) { env = null; return; }
  const entry = path.join(RES, 'server', 'server.mjs');
  note(`starting the server: ${entry}, vault ${VAULT}`);
  const child = utilityProcess.fork(entry, [], { env, stdio: 'pipe', serviceName: 'Synapse Server' });
  server = child;
  const out = (log ??= openLog());
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.once('exit', (code) => onServerExit(child, code));
  for (const until = Date.now() + 45_000; Date.now() < until;) {
    if (server !== child) return;
    if (await health()) {
      note('the server is ready');
      setPhase('ready');
      void learnLocale();
      return;
    }
    await sleep(250);
  }
  if (server === child) { note('the server did not answer within 45 s'); failure = tail(); setPhase('failed'); }
}

function onServerExit(child: UtilityProcess, code: number): void {
  if (server !== child) return;
  server = null;
  busy = false;
  note(`the server stopped (exit code ${code})`);
  if (quitting || !unlocked) return;
  const now = Date.now();
  stops = [...recentStops(stops, now), now];
  const wait = restartDelay(stops.length);
  if (wait === null) { failure = tail(); setPhase('failed'); return; }
  setPhase('starting');
  setTimeout(() => { void startServer(); }, wait);
}

/**
 * Stops the server. Its shutdown cancels a run at work and waits for it (up to 12 s, so its edits are committed and
 * its CLI ends with it); a server that does not end in 16 s is killed, and the kill is waited for too.
 */
function stopServer(): Promise<void> {
  const child = server;
  server = null;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let killed: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
      killed = setTimeout(resolve, 2000);
    }, 16_000);
    child.once('exit', () => { clearTimeout(timer); clearTimeout(killed); resolve(); });
    child.kill();
  });
}

/** The app page saves what is being typed (drafts, an item's text) before it is replaced by the lock page. */
function letPageSave(w: BrowserWindow): Promise<void> {
  if (!onAppPage(w)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); ipcMain.removeListener('desktop:saved', done); resolve(); };
    const timer = setTimeout(done, 2500);
    ipcMain.once('desktop:saved', done);
    w.webContents.send('desktop:locking');
  });
}

/** Closes the private disk; when a program holds it, the owner chooses: try again, close by force, or (quitting) leave it. */
async function sealWithOwner(quit: boolean): Promise<void> {
  for (;;) {
    try { await secure.seal(); return; } catch (error) { note(`the private disk did not close: ${(error as Error).message}`); }
    const s = STRINGS[locale];
    const buttons = [s.tryAgain, s.forceClose, ...(quit ? [s.quitAnyway] : [])];
    const options = { type: 'warning' as const, message: s.diskBusyMessage, detail: s.diskBusyDetail, buttons, defaultId: 0, cancelId: quit ? 2 : 0 };
    const { response } = win && !win.isDestroyed() && win.isVisible() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response === 1) {
      try { await secure.seal({ force: true, tries: 2 }); return; } catch (error) { note(`forced close failed: ${(error as Error).message}`); }
    }
    // Quitting anyway: the volume guard started at launch keeps trying to close the disk after the app is gone.
    if (response === 2) return;
  }
}

async function lockVault(opts: { quit?: boolean } = {}): Promise<void> {
  autoTouchId = false;
  lockWhenIdle = null;
  if (authPending) { lockRequested = true; while (authPending) await sleep(100); }
  if (lockPromise) return lockPromise;
  if (!unlocked && !(await secure.mounted().catch(() => false))) return;
  lockPromise = (async () => {
    if (win && !win.isDestroyed()) await letPageSave(win);
    unlocked = false; phase = 'locked'; env = null; busy = false;
    if (win && !win.isDestroyed()) await win.loadFile(path.join(__dirname, 'lock.html')).catch(() => undefined);
    await sleep(300);
    await stopServer();
    if (log) { const old = log; log = null; await new Promise<void>((resolve) => old.end(resolve)); }
    // Only the per-device choices (localStorage) stay; caches and anything else the page stored go with the lock.
    await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'] }).catch(() => undefined);
    await session.fromPartition(PARTITION).clearCache().catch(() => undefined);
    await sealWithOwner(opts.quit === true);
    note('locked');
  })();
  try { await lockPromise; } finally {
    lockPromise = null;
    if (autoTouchId && win && !win.isDestroyed() && win.isVisible()) win.webContents.send('desktop:state', view());
  }
}

/**
 * A lock the owner did not ask for in so many words (closing the window, the screen locking, sleep) waits while the
 * brain works, so a run is never cut; the menu's Lock asks. Quitting asks in `confirmQuit`.
 */
async function requestLock(reason: 'close' | 'screen' | 'sleep' | 'menu'): Promise<void> {
  if (unlocked && phase === 'ready') busy = (await health())?.busy === true;
  if (!unlocked || !busy) { await lockVault(); return; }
  lockReason = reason;
  if (reason !== 'menu') { lockWhenIdle ??= Date.now(); note(`lock waits for the brain (${reason})`); return; }
  const s = STRINGS[locale];
  const options = { type: 'question' as const, buttons: [s.lockAfter, s.lockNow], defaultId: 0, cancelId: 0, message: s.lockBusyMessage, detail: s.lockBusyDetail };
  const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response === 1) await lockVault(); else lockWhenIdle ??= Date.now();
}

async function retry(): Promise<void> {
  if (!unlocked) return;
  stops = [];
  failure = '';
  await stopServer();
  void startServer();
}

const onAppPage = (w: BrowserWindow): boolean => isAppUrl(w.webContents.getURL(), PORT);
const touchUsable = (): boolean => biometric && systemPreferences.canPromptTouchID();
const view = (): Record<string, unknown> => {
  const due = biometric && passwordDue(passwordAt, new Date());
  return {
    phase, port: PORT, locale, configured, biometric: touchUsable() && !due, enrolled: biometric, passwordDue: due,
    touchUnavailable: biometric && !due && !systemPreferences.canPromptTouchID(),
    autoRequestId, autoTouchId: autoTouchId && !quitting && !lockPromise && touchUsable() && !due,
    failure: phase === 'failed' && unlocked ? failure : '', text: { ...STRINGS[locale], ...LOCK_STRINGS[locale] },
  };
};

function setPhase(next: Phase): void {
  if (!unlocked && next !== 'locked') return;
  phase = next;
  const w = win && !win.isDestroyed() ? win : null;
  if (!w) return;
  w.webContents.send('desktop:state', view());
  // While the server starts again the page stays (it waits and reconnects); the start page shows only before the
  // first answer and when the server cannot start.
  if (next === 'ready' && !onAppPage(w)) void w.loadURL(APP_URL);
  if ((next === 'port' || next === 'failed') && onAppPage(w)) void w.loadFile(path.join(__dirname, 'start.html'));
}

function loadCurrent(w: BrowserWindow): void {
  if (w.isDestroyed()) return;
  if (!unlocked) { void w.loadFile(path.join(__dirname, 'lock.html')); return; }
  void (phase === 'ready' ? w.loadURL(APP_URL) : w.loadFile(path.join(__dirname, 'start.html')));
}

function rememberWindow(w: BrowserWindow): void {
  if (w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return;
  writeShellState({ window: { ...(w.isMaximized() ? w.getNormalBounds() : w.getBounds()), maximized: w.isMaximized() } });
}

function editMenu(p: ContextMenuParams): Menu | null {
  const items: MenuItemConstructorOptions[] = [];
  if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  else if (p.selectionText.trim()) items.push({ role: 'copy' });
  return items.length ? Menu.buildFromTemplate(items) : null;
}

function createWindow(): BrowserWindow {
  const saved = fitBounds(readShellState().window, screen.getAllDisplays().map((d) => d.workArea), MIN);
  const w = new BrowserWindow({
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1360, height: 900, center: true }),
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    title: 'Synapse',
    backgroundColor: readShellState().theme === 'light' ? '#eef1f7' : '#0b0f17',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, partition: PARTITION },
  });
  w.once('ready-to-show', () => { if (saved?.maximized) w.maximize(); w.show(); });
  let saveTimer: NodeJS.Timeout | undefined;
  const saveSoon = (): void => { clearTimeout(saveTimer); saveTimer = setTimeout(() => rememberWindow(w), 600); };
  w.on('resized', saveSoon).on('moved', saveSoon);
  // A Mac app keeps running with its window closed: hide it, and the Dock icon or opening the app shows it again.
  w.on('close', (e) => {
    rememberWindow(w);
    if (quitting) return;
    e.preventDefault();
    void requestLock('close').catch((err: unknown) => note(`lock failed: ${String(err)}`));
    if (w.isFullScreen()) { w.once('leave-full-screen', () => w.hide()); w.setFullScreen(false); } else w.hide();
  });
  const wc = w.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url, PORT)) return;
    e.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  wc.on('render-process-gone', (_e, details) => {
    note(`the page stopped (${details.reason}, exit code ${details.exitCode})`);
    if (!quitting) setTimeout(() => loadCurrent(w), 600);
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || quitting) return; // -3: a load replaced by the next one
    note(`the page did not load (${code} ${description}): ${url}`);
    setTimeout(() => loadCurrent(w), 1500);
  });
  wc.on('context-menu', (_e, params) => editMenu(params)?.popup({ window: w }));
  loadCurrent(w);
  return w;
}

function showWindow(force = false): void {
  if (!started) return; // the startup creates the window itself
  if (unlocked) lockWhenIdle = null; // shown again while a run kept it open: it stays open
  if (!win || win.isDestroyed()) { autoTouchId = true; win = createWindow(); return; }
  const opening = force || !win.isVisible() || win.isMinimized();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (opening && !unlocked && !authPending) {
    autoTouchId = true;
    autoRequestId++;
    win.webContents.send('desktop:state', view());
  }
}

function appMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Synapse', submenu: [{ label: 'Lock Synapse', accelerator: 'Command+Shift+L', click: () => { void requestLock('menu').catch((err: unknown) => note(`lock failed: ${String(err)}`)); } }, { type: 'separator' }, { role: 'about' }, { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open in Browser', click: () => { if (unlocked) void shell.openExternal(APP_URL); } },
        { label: 'Open the Data Folder', click: () => { void shell.openPath(DATA); } },
        { label: 'Open the Server Log', click: () => { void shell.openPath(unlocked ? LOG_FILE : SHELL_LOG); } },
      ],
    },
  ]);
}

/** The pages may write to the clipboard and go full screen; nothing else (no microphone, camera or location). */
function guardPermissions(): void {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
  session.fromPartition(PARTITION).setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

/** A recovery key made by this unlock, shown once over the window (with Copy). */
async function showRecoveryKey(key: string): Promise<void> {
  const s = STRINGS[locale];
  for (;;) {
    const options = { type: 'info' as const, message: s.recoveryMessage, detail: s.recoveryDetail.replace('{key}', key), buttons: [s.recoverySaved, s.recoveryCopy], defaultId: 0, cancelId: 0 };
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response !== 1) return;
    clipboard.writeText(key);
  }
}

let asking = false;
/** The last look at the server may be seconds old: look again, and ask only while the brain is really at work. */
async function confirmQuit(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    busy = (await health())?.busy === true;
    if (busy) {
      await learnLocale();
      const s = STRINGS[locale];
      const options = { type: 'question' as const, buttons: [s.quit, s.stay], defaultId: 1, cancelId: 1, message: s.busyMessage, detail: s.busyDetail };
      const answer = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (answer.response !== 0) return;
      busy = false;
    }
  } finally {
    asking = false;
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  process.on('uncaughtException', (err) => note(`uncaught: ${err.stack ?? String(err)}`));
  app.on('second-instance', () => showWindow(true));
  app.on('activate', () => showWindow());
  // On a Mac the app stays in the Dock with no window; elsewhere closing the window would end it.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('child-process-gone', (_e, d) => note(`a ${d.type} process stopped (${d.reason}, exit code ${d.exitCode})`));
  app.on('before-quit', (e) => {
    if (quitting) return;
    // Asked only while the brain works; otherwise quitting locks first (a disk that will not close asks once).
    if (busy) { e.preventDefault(); void confirmQuit(); return; }
    e.preventDefault();
    if (win && !win.isDestroyed()) rememberWindow(win);
    note('quitting');
    void lockVault({ quit: true })
      .then(() => secure.refreshBackup().then((done) => { if (done) note('the encrypted backup was refreshed'); }).catch((err: unknown) => note(`backup refresh failed: ${String(err)}`)))
      .catch((err: unknown) => note(`lock on quit failed: ${String(err)}`))
      .finally(() => { quitting = true; app.quit(); });
  });
  // The server stops once the window has closed, so the page's last save (sent as it closes) still reaches it.
  app.on('will-quit', () => { server?.kill(); });
  void app.whenReady().then(async () => {
    try { await secure.seal(); } catch { dialog.showErrorBox('Synapse', 'The private volume could not be closed. Close programs using it and reopen Synapse.'); app.exit(1); return; }
    const watcher = spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; while mount | /usr/bin/grep -Fq " on $2 ("; do /usr/bin/hdiutil detach "$2" >/dev/null 2>&1; sleep 1; done', 'synapse-volume-guard', String(process.pid), secure.mount], { detached: true, stdio: 'ignore' });
    watcher.unref();
    configured = await secure.configured();
    biometric = configured && await secure.biometricAvailable();
    passwordAt = configured ? await secure.passwordTypedAt() : undefined;
    nativeTheme.themeSource = readShellState().theme;
    ipcMain.on('desktop:theme', (_e, theme: unknown) => {
      if (theme !== 'dark' && theme !== 'light') return;
      nativeTheme.themeSource = theme;
      win?.setBackgroundColor(theme === 'light' ? '#eef1f7' : '#0b0f17');
      if (readShellState().theme !== theme) writeShellState({ theme });
    });
    app.setAboutPanelOptions({ applicationName: 'Synapse', applicationVersion: app.getVersion(), copyright: 'MIT License' });
    Menu.setApplicationMenu(appMenu());
    guardPermissions();
    powerMonitor.on('lock-screen', () => { void requestLock('screen').catch((err: unknown) => note(`lock failed: ${String(err)}`)); });
    powerMonitor.on('suspend', () => { void requestLock('sleep').catch((err: unknown) => note(`lock failed: ${String(err)}`)); });
    // The owner is back at an unlocked Mac before the run ended: the window stays as it was.
    powerMonitor.on('unlock-screen', () => { if (lockWhenIdle !== null && win?.isVisible()) lockWhenIdle = null; });
    ipcMain.handle('desktop:confirm-export', async () => {
      const s = STRINGS[locale];
      const options = { type: 'warning' as const, message: s.exportMessage, detail: s.exportDetail, buttons: [s.cancel, s.exportSave], defaultId: 0, cancelId: 0 };
      const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      return response === 1;
    });
    ipcMain.handle('desktop:unlock', async (event, value: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(path.join(__dirname, 'lock.html')).href) throw new Error('Unlock is only available on the lock screen.');
      if (authPending || lockPromise || unlocked) return { ok: false, code: 'wait' };
      if (!value || typeof value !== 'object') return { ok: false, code: 'wait' };
      const v = value as Record<string, unknown>;
      const str = (k: string): string | undefined => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
      const mode = str('mode') ?? 'unlock';
      const password = str('password');
      const next = str('next');
      if (next !== undefined && (next.length < 12 || next.length > 1024)) return { ok: false, code: 'password' };
      autoTouchId = false;
      authPending = true;
      lockRequested = false;
      try {
        // Changes that keep the app locked.
        if (mode === 'change' && password && next) { await secure.changePassword(password, next); passwordAt = await secure.passwordTypedAt(); note('the password was changed'); return { ok: true, done: 'change' }; }
        if (mode === 'touch-off' && password) { await secure.disableBiometric(password); biometric = false; note('Touch ID was turned off'); return { ok: true, done: 'touch-off' }; }
        let result: UnlockResult;
        if (!configured) { if (!password) return { ok: false, code: 'password' }; result = await secure.setup(password); }
        else if (mode === 'recover' && next) result = await secure.recover(str('recovery') ?? '', next);
        else if (password === undefined && !(touchUsable() && !passwordDue(passwordAt, new Date()))) return { ok: false, code: 'password' };
        else result = await secure.unlock(password);
        configured = true;
        passwordAt = await secure.passwordTypedAt();
        let notice = '';
        const enrollWith = password ?? next;
        if (v['enroll'] === true && enrollWith) { try { await secure.enroll(enrollWith); biometric = true; } catch { notice = STRINGS[locale].touchIdOff; } }
        if (lockRequested) { await secure.seal(); return { ok: false, code: 'wait' }; }
        VAULT = secure.vault; env = null; unlocked = true;
        note(`unlocked (${mode === 'recover' ? 'recovery key' : password === undefined ? 'Touch ID' : 'password'})`);
        setPhase('starting');
        if (win) loadCurrent(win);
        void startServer();
        if (result.recoveryKey) await showRecoveryKey(result.recoveryKey);
        if (notice) void dialog.showMessageBox({ message: notice });
        return { ok: true };
      } catch (error) {
        const code = error instanceof VaultError ? error.code : 'storage';
        note(`unlock failed (${mode}): ${code} — ${(error as Error).message}`);
        configured = await secure.configured();
        if (code !== 'disk-busy') await secure.seal().catch(() => undefined);
        await sleep(code === 'password' || code === 'recovery' ? 1500 : 200);
        return { ok: false, code };
      } finally { authPending = false; lockRequested = false; }
    });
    ipcMain.handle('desktop:state', () => view());
    ipcMain.on('desktop:retry', () => { void retry(); });
    ipcMain.on('desktop:open-log', () => { void shell.openPath(LOG_FILE); });
    started = true;
    win ??= createWindow();
    setInterval(() => {
      if (phase !== 'ready' || quitting) return;
      void health().then((h) => {
        busy = h?.busy === true;
        // A waiting lock happens once the run ends, or after half an hour of a run that does not.
        if (lockWhenIdle !== null && (!busy || Date.now() - lockWhenIdle > 30 * 60_000) && (lockReason !== 'close' || !win?.isVisible())) {
          void lockVault().catch((err: unknown) => note(`lock failed: ${String(err)}`));
        }
      });
    }, 4000);
  });
}
