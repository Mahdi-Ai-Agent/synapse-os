import { Check, Download, KeyRound, ListRestart, Loader2, RefreshCw, Undo2, Upload } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { confirmExport } from '../lib/desktop';
import { engineShortName } from '../components/EnginePill';
import { effortLabel, fitEffort } from '../lib/efforts';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, fmtNum, inputDir, sep } from '../lib/format';
import { ApiError } from '../lib/api';
import { getPairToken, isLoopbackOrigin, setPairToken } from '../lib/pairing';
import { AuthForm } from '../components/AuthScreen';
import { EngineSignIn } from '../components/EngineSignIn';
import { ConnectionsCard } from '../components/Connections';
import type { AuthStatus, Commit, EngineInfo, ImportAnswer, ServerDiagnostics, SettingsPatch } from '../lib/types';
import { clientErrors, onClientErrors } from '../lib/diagnostics';
import { useStore } from '../state/store';
import { FONT_OPTIONS, isInstalled, loadFontChoice, saveFontChoice, type FontChoice, type FontRole } from '../lib/fonts';

/** Settings (spec: docs/UI-DESIGN.md "Views"): vault, brain engines, phone pairing, language, history. */
/** The QR library loads with the Phone section only. */
const PhonePairing = lazy(() => import('../components/PhonePairing').then((m) => ({ default: m.PhonePairing })));

export function SettingsView() {
  const desktop = useStore((s) => s.enginePlace) === 'desktop';
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const vault = useStore((s) => s.vault);
  const engines = useStore((s) => s.engines);
  const setEngines = useStore((s) => s.setEngines);
  const setSettings = useStore((s) => s.setSettings);
  const setToast = useStore((s) => s.setToast);
  const [history, setHistory] = useState<Commit[]>([]);
  const [probing, setProbing] = useState(false);

  const loadHistory = (): void => { api.history().then((h) => setHistory(h.commits)).catch(() => setHistory([])); };
  useEffect(loadHistory, []);

  const reprobe = async (force = true): Promise<void> => {
    setProbing(true);
    try { const r = await api.engines(force); setEngines(r.engines, r.place); } catch (e) { setToast((e as Error).message); } finally { setProbing(false); }
  };
  const update = async (patch: SettingsPatch): Promise<void> => {
    try {
      setSettings(await api.putSettings(patch));
      if (patch.locale) setLocale(patch.locale);
      // The chat's brain picker shows each engine's defaults from `/api/engines`: read them again after any change to them.
      if (patch.engine !== undefined || patch.apiKeys || patch.engines) await reprobe(Boolean(patch.apiKeys));
    } catch (e) { setToast((e as Error).message); }
  };
  const undo = async (hash: string): Promise<void> => {
    try { await api.undo(hash); setToast(t('chat.undone')); loadHistory(); } catch (e) { setToast((e as Error).message); }
  };

  const stats = vault?.stats ?? {};
  return (
    <div className="view-body max-w-3xl">
      <header className="view-header"><div><h1 className="view-title">{t('settings.title')}</h1></div></header>
      <div className="mt-6 space-y-4">
        <section className="card text-sm">
          <h3 className="card-title">{t('settings.vault')}</h3>
          <div className="font-mono text-xs text-muted" dir="ltr">{vault?.path}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            {Object.entries((stats['byType'] as Record<string, number> | undefined) ?? {}).map(([k, v]) => <span key={k} className="pill">{t(`type.${k}` as TKey)} {fmtNum(v, locale)}</span>)}
            <span className="pill">{t('graph.edges')} {fmtNum(Number(stats['edges'] ?? 0), locale)}</span>
          </div>
        </section>

        <section className="card text-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="card-title mb-0">{t('settings.engine')}</h3>
            <button onClick={() => void reprobe()} disabled={probing} className="btn-soft"><RefreshCw size={12} className={probing ? 'animate-spin' : ''} />{t('common.refresh')}</button>
          </div>
          {desktop ? (
            <>
              <p className="mb-3 text-xs leading-relaxed text-muted">{t('brain.desktopHint')}</p>
              <div className="space-y-3">
                {engines.filter((e) => e.auth === 'cli-login').map((e) => <DesktopEngineCard key={e.id} engine={e} update={update} refresh={() => reprobe(true)} />)}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">{t('brain.otherWays')}</summary>
                <div className="mt-3 space-y-3">
                  {engines.filter((e) => e.auth === 'api-key').map((e) => <EngineCard key={e.id} engine={e} update={update} refresh={() => reprobe(true)} />)}
                </div>
              </details>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">{t('settings.engineHint')}</p>
              <div className="space-y-3">
                {engines.map((e) => <EngineCard key={e.id} engine={e} update={update} refresh={() => reprobe(true)} />)}
              </div>
            </>
          )}
        </section>

        <AccountCard />

        <ConnectionsCard />

        <Suspense fallback={null}><PhonePairing /></Suspense>

        <section className="card text-sm">
          <h3 className="card-title">{t('settings.language')}</h3>
          <div className="flex gap-2">
            {(['fa', 'en'] as const).map((l) => (
              <button key={l} onClick={() => void update({ locale: l })} className={`chip-toggle ${locale === l ? 'is-on' : ''}`}>{l === 'fa' ? 'فارسی' : 'English'}</button>
            ))}
          </div>
        </section>

        <Appearance />

        <section className="card text-sm">
          <h3 className="card-title">{t('settings.history')}</h3>
          <ul className="space-y-0.5">
            {history.map((c) => (
              <li key={c.hash} className="row text-xs">
                <span className="w-36 shrink-0 text-muted">{fmtDateTime(c.date, locale)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]"><bdi>{c.subject}</bdi></span>
                {(c.subject.startsWith('brain(') || c.subject.startsWith('mcp(')) && <button onClick={() => void undo(c.hash)} className="flex items-center gap-1 text-muted hover:text-text" title={t('settings.undo')}><Undo2 size={12} /></button>}
              </li>
            ))}
          </ul>
        </section>
        <BackupCard />
        <DiagnosticsCard />
        <DangerCard />
      </div>
    </div>
  );
}

/** The owner's account (UI-DESIGN "Views" → Settings): who is signed in, sign out, a new password; on the desktop, creating it. */
function AccountCard() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const [st, setSt] = useState<AuthStatus | null>(null);
  const [mode, setMode] = useState<'idle' | 'create' | 'password'>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const load = (): void => { api.authStatus().then(setSt).catch(() => undefined); };
  useEffect(load, []);
  if (!st) return null;
  const keep = (token: string): void => { if (!isLoopbackOrigin() || getPairToken()) setPairToken(token); };
  const signOut = async (): Promise<void> => {
    try { await api.authLogout(); } catch { /* signed out locally either way */ }
    setPairToken(null);
    location.replace(location.pathname);
  };
  const changePassword = async (): Promise<void> => {
    if (next.length < 8) { setToast(t('auth.tooShort')); return; }
    setBusy(true);
    try {
      const r = await api.authPassword({ current, next });
      keep(r.token);
      setToast(t('settings.passwordChanged'));
      setMode('idle'); setCurrent(''); setNext('');
    } catch (e) {
      setToast(e instanceof ApiError && e.status === 403 ? t('settings.passwordWrong') : (e as Error).message);
    } finally { setBusy(false); }
  };
  const field = 'h-8 rounded-md border border-line bg-transparent px-2 text-xs text-text outline-none focus:border-accent';
  return (
    <section className="card text-sm">
      <h3 className="card-title">{t('settings.account')}</h3>
      {!st.account ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-muted">{t('settings.accountNone')}</p>
          {mode === 'create'
            ? <AuthForm setup needsCode={st.needsCode} onDone={(token) => { keep(token); setMode('idle'); setToast(t('settings.accountMade')); load(); }} />
            : <button onClick={() => setMode('create')} className="btn-soft">{t('auth.create')}</button>}
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">{t('settings.signedInAs').replace('{u}', '')}<bdi className="font-medium text-text">{st.username}</bdi></p>
          {mode === 'password' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={t('settings.currentPassword')} aria-label={t('settings.currentPassword')} autoComplete="current-password" dir="ltr" className={`${field} w-40`} />
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={t('settings.newPassword')} aria-label={t('settings.newPassword')} autoComplete="new-password" dir="ltr" className={`${field} w-40`} />
              <button onClick={() => void changePassword()} disabled={!current || !next || busy} className="btn-soft">{t('common.save')}</button>
              <button onClick={() => { setMode('idle'); setCurrent(''); setNext(''); }} className="btn-soft">{t('common.cancel')}</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setMode('password')} className="btn-soft">{t('settings.changePassword')}</button>
              {st.session && <button onClick={() => void signOut()} className="btn-soft">{t('settings.signOut')}</button>}
            </div>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">{t('settings.accountReset')}</p>
        </>
      )}
    </section>
  );
}

/**
 * Settings → Diagnostics (docs/ARCHITECTURE.md "Diagnostics"): how live events arrive, the server's state and the last
 * errors on both sides, each with the code the UI showed next to the failure; "Copy report" puts it all on the
 * clipboard to send along.
 */
function DiagnosticsCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const live = useStore((s) => s.live);
  const setToast = useStore((s) => s.setToast);
  const [server, setServer] = useState<ServerDiagnostics | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [, bump] = useState(0);
  const load = (): void => { api.diagnostics().then((d) => { setServer(d); setServerError(null); }).catch((e: Error) => setServerError(e.message)); };
  useEffect(load, []);
  useEffect(() => onClientErrors(() => bump((n) => n + 1)), []);
  const mine = clientErrors();
  const errors = [...mine.map((e) => ({ ...e, side: 'client' as const })), ...(server?.errors ?? []).map((e) => ({ ...e, side: 'server' as const }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const copy = (): void => {
    const report = { at: new Date().toISOString(), url: location.origin, userAgent: navigator.userAgent, live, client: mine, server: server ?? serverError };
    void navigator.clipboard?.writeText(JSON.stringify(report, null, 2)).then(() => setToast(t('diag.copied')));
  };
  return (
    <section className="card text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="card-title mb-0">{t('diag.title')}</h3>
        <div className="flex gap-2">
          <button onClick={load} className="btn-soft"><RefreshCw size={12} />{t('common.refresh')}</button>
          <button onClick={copy} className="btn-soft">{t('diag.copy')}</button>
        </div>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-muted">{t('diag.hint')}</p>
      <div className="diag-row"><span className="text-muted">{t('diag.live')}</span>
        <span><bdi>{t(`diag.mode.${live.mode}` as TKey)}</bdi>{(live.code ?? live.detail) && <span className="ms-2 font-mono text-[11px] text-muted" dir="ltr">{live.code ?? live.detail}</span>}
          {live.mode === 'http' && <span className="mt-0.5 block text-[11px] text-muted">{t('diag.httpWhy')}</span>}</span>
      </div>
      <div className="diag-row"><span className="text-muted">{t('diag.server')}</span>
        <span>{server ? <><bdi>{t('diag.started')} {fmtDateTime(server.startedAt, locale)}</bdi> <span className="font-mono text-[11px] text-muted" dir="ltr">{server.node} · {server.platform}</span></> : <span className="font-mono text-[11px] text-danger" dir="ltr">{serverError ?? '…'}</span>}</span>
      </div>
      <div className="diag-row"><span className="text-muted">{t('diag.errors')}</span>
        {errors.length === 0 ? <span className="text-muted">{t('diag.noErrors')}</span> : (
          <ul className="space-y-1.5">
            {errors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="leading-relaxed">
                <span className="font-mono text-[11px] font-semibold text-warn" dir="ltr">{e.code}</span>
                {e.requestId && <span className="ms-1.5 font-mono text-[11px] text-muted" dir="ltr">{e.requestId}</span>}
                <span className="ms-1.5 text-[11px] text-muted">{fmtDateTime(e.at, locale)}{sep(locale)}{e.side === 'server' ? t('diag.sideServer') : t('diag.sideClient')}</span>
                <span className="block font-mono text-[11px] text-text" dir="ltr"><bdi>{e.path ? `${e.path} — ` : ''}{e.message}</bdi></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Backup and move (UI-DESIGN "Views" → Settings): everything in one zip, and a zip brought in in place of what is
 * here — read first, so the confirmation can say what it holds; the app reloads once it is in.
 */
function BackupCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'read' | 'import' | null>(null);
  const [pending, setPending] = useState<{ file: File; info: ImportAnswer } | null>(null);
  const failed = (e: unknown): void => {
    const status = e instanceof ApiError ? e.status : 0;
    setToast(status === 400 ? t('backup.badFile') : status === 409 ? t('backup.busy') : (e as Error).message);
  };
  const download = async (): Promise<void> => {
    if (!await confirmExport()) return;
    setBusy('export');
    try {
      const { blob, filename } = await api.exportAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setToast(t('backup.exported'));
    } catch (e) { failed(e); } finally { setBusy(null); }
  };
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy('read');
    try { setPending({ file, info: await api.importAll(file, true) }); } catch (e) { failed(e); } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const replace = async (): Promise<void> => {
    if (!pending) return;
    setBusy('import');
    try {
      await api.importAll(pending.file, false);
      setToast(t('backup.imported'));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { failed(e); setBusy(null); }
  };
  const holds = pending ? t('backup.holds').replace('{items}', fmtNum(pending.info.counts.items, locale)).replace('{chats}', fmtNum(pending.info.counts.chats, locale)).replace('{date}', fmtDate(pending.info.exportedAt, locale)) : '';
  return (
    <section className="card text-sm">
      <h3 className="card-title">{t('backup.title')}</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('backup.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void download()} disabled={busy !== null} className="btn-soft">{busy === 'export' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}{busy === 'export' ? t('backup.exporting') : t('backup.export')}</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy !== null} className="btn-soft">{busy === 'read' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}{busy === 'read' ? t('backup.reading') : t('backup.import')}</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} aria-label={t('backup.import')} />
      </div>
      {pending && (
        <div className="mt-3 rounded-md border border-line p-3">
          <p className="text-xs leading-relaxed">{holds}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('backup.replaceWarn')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void replace()} disabled={busy !== null} className="btn-danger h-8 text-xs">{busy === 'import' && <Loader2 size={12} className="animate-spin" />}{t('backup.replace')}</button>
            <button onClick={() => setPending(null)} disabled={busy === 'import'} className="btn-ghost h-8 text-xs">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Erase everything: a typed confirmation, then the vault starts fresh and the app reloads (UI-DESIGN "Views" → Settings). */
function DangerCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const expected = t('settings.eraseWord');
  const erase = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.eraseVault(word.trim());
      setToast(t('settings.erased'));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { setToast((e as Error).message); setBusy(false); }
  };
  return (
    <section className="card text-sm">
      <h3 className="card-title text-danger">{t('settings.danger')}</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('settings.dangerHint')}</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-danger h-8 text-xs">{t('settings.danger')}</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">{t('settings.eraseType').replace('{w}', expected)}</label>
          <input value={word} onChange={(e) => setWord(e.target.value)} dir={inputDir(word, locale)} autoFocus className="h-8 w-36 rounded-md border border-line bg-transparent px-2 text-xs text-text outline-none focus:border-accent" aria-label={t('settings.eraseType').replace('{w}', expected)} />
          <button disabled={word.trim() !== expected || busy} onClick={() => void erase()} className="btn-danger h-8 text-xs">{t('settings.danger')}</button>
          <button onClick={() => { setOpen(false); setWord(''); }} className="btn-ghost h-8 text-xs">{t('common.cancel')}</button>
        </div>
      )}
    </section>
  );
}

/**
 * A CLI engine on the owner's own computer (UI-DESIGN "Views" → Settings → Brain on a desktop): the app that brings
 * it, the account it is signed in to, and once it is ready the model and how hard it thinks; picking it makes it the
 * brain. No sign-out here: the sign-in belongs to Claude Code or the ChatGPT app on this computer, not to Synapse.
 */
function DesktopEngineCard({ engine: e, update, refresh }: { engine: EngineInfo; update: (patch: SettingsPatch) => Promise<void>; refresh: () => Promise<void> }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setToast = useStore((s) => s.setToast);
  const codex = e.id === 'codex-cli';
  const ready = e.probe.installed && e.probe.loggedIn;
  const defaults = settings?.engines[e.id] ?? {};
  const model = defaults.model ?? e.defaults.model;
  const current = e.models.find((m) => m.id === model);
  const efforts = current?.efforts ?? e.efforts;
  const effort = defaults.effort ?? e.defaults.effort;
  const modelOptions = current || !model ? e.models : [{ id: model, label: model }, ...e.models];
  const pickModel = (id: string): void => {
    void update({ engines: { [e.id]: { model: id, ...fitEffort(e, id, effort) } } });
  };
  const via = e.probe.via ? t(`brain.via.${e.probe.via}` as TKey) : '';
  return (
    <div className={`engine-card ${e.selected ? 'is-selected' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text">{t(codex ? 'brain.codexName' : 'brain.claudeName')}</span>
        <Pill ok={ready} warn={e.probe.installed}>{ready ? t('brain.ready') : e.probe.installed ? t('settings.notLoggedIn') : t('settings.notInstalled')}</Pill>
        <span className="flex-1" />
        {e.selected ? (
          <span className="flex items-center gap-1 text-xs text-accent"><Check size={13} />{t('settings.inUse')}</span>
        ) : (
          <button onClick={() => void update({ engine: e.id })} disabled={!ready} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50">{t('settings.use')}</button>
        )}
      </div>
      <p className="mt-1 text-[11.5px] text-muted">{t(codex ? 'brain.codexWhat' : 'brain.claudeWhat')}</p>
      {ready && (
        <p className="mt-1 text-[11.5px] text-muted">
          {t('brain.signedInAs')} <bdi className="font-mono text-text" dir="ltr">{e.probe.account ?? e.probe.detail ?? '—'}</bdi>
          {via && <> · {via}</>}
          {e.probe.version && <> · {t('settings.version')} <bdi dir="ltr">{e.probe.version}</bdi></>}
        </p>
      )}
      {!e.probe.installed && <div className="fix-box"><p>{t(codex ? 'brain.codexInstall' : 'brain.claudeInstall')}</p></div>}
      {e.probe.installed && !e.probe.loggedIn && (
        <>
          <div className="fix-box"><p>{t(codex ? 'brain.codexSignIn' : 'brain.claudeSignIn')}</p></div>
          {e.signIn && <EngineSignIn engine={e} onSignedIn={() => { void refresh(); setToast(t('signin.done')); }} />}
        </>
      )}
      {ready && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">{t('settings.defaultModel')}
            <select value={model} onChange={(ev) => pickModel(ev.target.value)} className="mt-1 block w-full rounded-md border border-line bg-bg2 px-2 py-1 text-sm text-text" dir="ltr">
              {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {efforts.length > 0 && (
            <label className="text-xs text-muted">{t('settings.defaultEffort')}
              <select value={efforts.includes(effort) ? effort : ''} onChange={(ev) => void update({ engines: { [e.id]: { effort: ev.target.value } } })} className="mt-1 block w-full rounded-md border border-line bg-bg2 px-2 py-1 text-sm text-text">
                {!efforts.includes(effort) && <option value="" disabled>{effort}</option>}
                {efforts.map((x) => <option key={x} value={x}>{effortLabel(x, t)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const PROVIDER_OF: Record<string, 'anthropic' | 'openai' | 'openrouter'> = { 'anthropic-api': 'anthropic', 'openai-api': 'openai', openrouter: 'openrouter' };

/** The fix in the UI language; the exact commands from the server stay below it, as written (docs/BRAIN-ENGINES.md). */
function localFix(e: EngineInfo, t: (k: TKey) => string): string {
  if (e.auth === 'api-key') return e.key ? t('fix.keyRejected') : t('fix.noKey').replace('{env}', e.keyEnv ?? '');
  const name = engineShortName(e.name);
  return (e.probe.installed ? t('fix.cliLogin') : t('fix.cliInstall')).replace('{name}', name);
}

function Pill({ ok, warn, children }: { ok: boolean; warn?: boolean; children: string }) {
  const tone = ok ? 'bg-ok/15 text-ok' : warn ? 'bg-warn/15 text-warn' : 'bg-danger/15 text-danger';
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>;
}

/** Where each API engine's keys are made (Settings → Brain). */
const KEY_SITE: Record<string, string> = {
  'anthropic-api': 'https://console.anthropic.com/settings/keys',
  'openai-api': 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/settings/keys',
};

/**
 * One engine (UI-DESIGN "Views" → Settings → Brain): status, then the way to connect it — sign in with the vendor's
 * own page (CLI engines) or paste a key (API engines) — and, once connected, the model and effort it uses.
 */
function EngineCard({ engine: e, update, refresh }: { engine: EngineInfo; update: (patch: SettingsPatch) => Promise<void>; refresh: () => Promise<void> }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const engines = useStore((s) => s.engines);
  const setEngines = useStore((s) => s.setEngines);
  const setToast = useStore((s) => s.setToast);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState<'key' | 'models' | 'signout' | null>(null);
  const provider = PROVIDER_OF[e.id];
  const defaults = settings?.engines[e.id] ?? {};
  const model = defaults.model ?? e.defaults.model;
  const effort = defaults.effort ?? e.defaults.effort;
  const modelOptions = e.models.some((m) => m.id === model) || !model ? e.models : [{ id: model, label: model }, ...e.models];

  const saveKey = async (): Promise<void> => {
    if (!provider || !keyDraft.trim()) return;
    setBusy('key');
    try { await update({ apiKeys: { [provider]: keyDraft.trim() } }); setKeyDraft(''); setToast(t('settings.keySaved')); } finally { setBusy(null); }
  };
  const clearKey = async (): Promise<void> => {
    if (!provider) return;
    setBusy('key');
    try { await update({ apiKeys: { [provider]: null } }); setToast(t('settings.keyRemoved')); } finally { setBusy(null); }
  };
  const fetchModels = async (): Promise<void> => {
    setBusy('models');
    try {
      const r = await api.engineModels(e.id);
      setEngines(engines.map((x) => (x.id === e.id ? { ...x, models: r.models } : x)));
      setToast(`${t('settings.modelsFetched')} (${r.models.length} ${t('settings.models')})`);
    } catch (err) { setToast((err as Error).message); } finally { setBusy(null); }
  };

  const signOut = async (): Promise<void> => {
    setBusy('signout');
    try { await api.signOut(e.id); await refresh(); setToast(t('signin.signedOut')); } catch (err) { setToast((err as Error).message); } finally { setBusy(null); }
  };

  const isApi = e.auth === 'api-key';
  const connected = isApi ? Boolean(e.key) && e.probe.loggedIn : e.probe.loggedIn;
  const canSignIn = !isApi && e.signIn !== null && e.probe.installed;
  const showFix = Boolean(e.probe.fix) && (isApi ? Boolean(e.key) && !e.probe.loggedIn : !e.probe.installed || (!canSignIn && !e.probe.loggedIn));
  return (
    <div className={`engine-card ${e.selected ? 'is-selected' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text"><bdi>{e.name}</bdi></span>
        {isApi ? (
          <>
            <Pill ok={Boolean(e.key)} warn>{e.key ? `${t('settings.keySet')} · ${e.key.source === 'env' ? t('settings.keyFromEnv') : t('settings.keyFromSettings')}` : t('settings.keyMissing')}</Pill>
            {e.key && <Pill ok={e.probe.loggedIn}>{e.probe.loggedIn ? t('settings.keyAccepted') : t('settings.keyRejected')}</Pill>}
          </>
        ) : (
          <>
            <Pill ok={e.probe.installed}>{e.probe.installed ? t('settings.installed') : t('settings.notInstalled')}</Pill>
            <Pill ok={e.probe.loggedIn} warn>{e.probe.loggedIn ? t('settings.loggedIn') : t('settings.notLoggedIn')}</Pill>
            {e.probe.version && <span className="text-xs text-muted">{t('settings.version')} {e.probe.version}</span>}
          </>
        )}
        <span className="flex-1" />
        {e.selected ? (
          <span className="flex items-center gap-1 text-xs text-accent"><Check size={13} />{t('settings.inUse')}</span>
        ) : (
          <button onClick={() => void update({ engine: e.id })} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-text">{t('settings.use')}</button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {isApi ? t('settings.apiKeyAuth') : t('settings.cliLogin')}
        {isApi && e.keyEnv && <> · <bdi className="font-mono" dir="ltr">{e.keyEnv}</bdi></>}
        {e.probe.detail && <> · <bdi className="font-mono" dir="ltr">{e.probe.detail}</bdi></>}
      </p>
      {showFix && (
        <div className="fix-box">
          <p>{localFix(e, t)}</p>
          <pre dir="ltr">{e.probe.fix}</pre>
        </div>
      )}
      {canSignIn && !e.probe.loggedIn && <EngineSignIn engine={e} onSignedIn={() => { void refresh(); setToast(t('signin.done')); }} />}
      {canSignIn && e.probe.loggedIn && (
        <div className="mt-2"><button onClick={() => void signOut()} disabled={busy !== null} className="btn-soft">{busy === 'signout' ? <Loader2 size={12} className="animate-spin" /> : null}{t('signin.signOut')}</button></div>
      )}
      {isApi && !e.key && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{t('settings.keyGet')} <a href={KEY_SITE[e.id]} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" dir="ltr">{(KEY_SITE[e.id] ?? '').replace('https://', '')}</a></p>
      )}
      {!connected ? (
        <p className="mt-3 text-[11.5px] text-muted">{t('settings.connectFirst')}</p>
      ) : (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">{t('settings.defaultModel')}
          <select value={model} onChange={(ev) => void update({ engines: { [e.id]: { model: ev.target.value } } })} className="mt-1 block w-full rounded-md border border-line bg-bg2 px-2 py-1 text-sm text-text" dir="ltr">
            {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        {e.efforts.length > 0 && (
          <label className="text-xs text-muted">{t('settings.defaultEffort')}
            <select value={effort} onChange={(ev) => void update({ engines: { [e.id]: { effort: ev.target.value } } })} className="mt-1 block w-full rounded-md border border-line bg-bg2 px-2 py-1 text-sm text-text" dir="ltr">
              {e.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
      </div>
      )}
      {isApi && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-bg2 px-2 py-1 text-xs text-muted">
            <KeyRound size={13} />
            <input
              type="password"
              value={keyDraft}
              onChange={(ev) => setKeyDraft(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') void saveKey(); }}
              placeholder={e.key?.source === 'settings' ? e.key.masked : t('settings.apiKeyPh')}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted"
              dir="ltr"
              aria-label={t('settings.apiKey')}
            />
          </label>
          <button onClick={() => void saveKey()} disabled={!keyDraft.trim() || busy !== null} className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-black disabled:opacity-40">{t('settings.saveKey')}</button>
          {e.key?.source === 'settings' && <button onClick={() => void clearKey()} disabled={busy !== null} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-danger disabled:opacity-40">{t('settings.clearKey')}</button>}
          {e.canFetchModels && e.key && (
            <button onClick={() => void fetchModels()} disabled={busy !== null} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-40"><ListRestart size={12} className={busy === 'models' ? 'animate-spin' : ''} />{t('settings.fetchModels')}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Settings → Appearance: which font each role uses (spec: docs/UI-DESIGN.md "Type"). */
function Appearance() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [choice, setChoice] = useState<FontChoice>(() => loadFontChoice());
  const [installed] = useState(() => new Map(Object.values(FONT_OPTIONS).flat().map((o) => [o.id, isInstalled(o)])));
  const roles: Array<[FontRole, TKey, TKey | null]> = [['text', 'settings.fontText', null], ['display', 'settings.fontDisplay', null], ['reading', 'settings.fontReading', 'settings.fontReadingHint']];
  const pick = (role: FontRole, id: string): void => {
    const next = { ...choice, [role]: id };
    setChoice(next);
    saveFontChoice(next, locale);
  };
  return (
    <section className="card text-sm">
      <h3 className="card-title">{t('settings.appearance')}</h3>
      <div className="space-y-4">
        {roles.map(([role, label, hint]) => (
          <div key={role}>
            <div className="mb-1.5 text-xs font-semibold text-text">{t(label)}{hint && <span className="ms-2 font-normal text-muted">{t(hint)}</span>}</div>
            <div className="flex flex-wrap gap-2">
              {FONT_OPTIONS[role].map((o) => {
                const ok = installed.get(o.id) ?? true;
                return (
                  <button key={o.id} onClick={() => pick(role, o.id)} className={`font-option ${choice[role] === o.id ? 'is-on' : ''}`} style={{ fontFamily: `${o.stack}, ${role === 'display' ? '"Estedad"' : '"Vazirmatn"'}` }}>
                    <span className="text-[15px]">{role === 'display' ? 'سیناپس' : 'ذهن روشن'}</span>
                    <span className="font-option-meta" style={{ fontFamily: 'var(--font-sans)' }}>{o.label} · {o.commercial ? (ok ? t('settings.fontInstalled') : t('settings.fontMissing')) : t('settings.fontFree')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[11.5px] leading-relaxed text-muted">{t('settings.fontHint')}</p>
      </div>
    </section>
  );
}
