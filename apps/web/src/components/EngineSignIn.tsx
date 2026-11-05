import { Check, Copy, ExternalLink, Loader2, LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import type { EngineInfo, SignInState } from '../lib/types';

const ACTIVE = new Set(['starting', 'waiting', 'verifying']);

/**
 * Signing a vendor CLI in from Settings (UI-DESIGN "Views" → Settings → Brain): the server runs the CLI's own sign-in
 * and this box shows the vendor's page, then either takes the code that page shows (Claude) or shows the code to type
 * there (ChatGPT). The CLI on the server keeps the sign-in.
 */
export function EngineSignIn({ engine: e, onSignedIn }: { engine: EngineInfo; onSignedIn: () => void }) {
  const t = useT();
  const [st, setSt] = useState<SignInState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onSignedIn);
  done.current = onSignedIn;
  const claude = e.signIn === 'paste-code';
  const active = st !== null && ACTIVE.has(st.status);

  // A sign-in already running (another tab, a reload) is picked up where it is.
  useEffect(() => { api.signInState(e.id).then((r) => setSt(r.signIn)).catch(() => undefined); }, [e.id]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      api.signInState(e.id).then((r) => {
        setSt(r.signIn);
        if (r.signIn?.status === 'done') done.current();
      }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
  }, [active, e.id]);

  const start = async (): Promise<void> => {
    setBusy(true); setError(null);
    try { setSt(await api.signInStart(e.id)); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const submit = async (): Promise<void> => {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { setSt(await api.signInCode(e.id, code.trim())); setCode(''); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const cancel = async (): Promise<void> => {
    await api.signInCancel(e.id).catch(() => undefined);
    setSt(null); setCode(''); setError(null);
  };
  const copyCode = (): void => {
    if (!st?.code) return;
    void navigator.clipboard?.writeText(st.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  if (!st || st.status === 'cancelled' || st.status === 'done') {
    return (
      <div className="signin-box">
        <button onClick={() => void start()} disabled={busy} className="btn-primary h-9 text-xs">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {claude ? t('signin.claude') : t('signin.codex')}
        </button>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{claude ? t('signin.hintClaude') : t('signin.hintCodex')}</p>
        {error && <p className="mt-2 text-xs text-danger"><bdi>{error}</bdi></p>}
      </div>
    );
  }

  if (st.status === 'failed') {
    return (
      <div className="signin-box">
        <p className="text-xs font-medium text-danger">{t('signin.failed')}</p>
        {st.message && <p className="mt-1 font-mono text-[11px] text-muted" dir="ltr"><bdi>{st.message}</bdi></p>}
        <button onClick={() => void start()} disabled={busy} className="btn-soft mt-2">{t('signin.retry')}</button>
      </div>
    );
  }

  return (
    <div className="signin-box space-y-3">
      {st.status === 'starting' || !st.url ? (
        <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={13} className="animate-spin" />{t('signin.starting')}</p>
      ) : (
        <>
          <div>
            <p className="text-xs text-text">{t('signin.step1')}</p>
            <a href={st.url} target="_blank" rel="noopener noreferrer" className="btn-soft mt-1.5 inline-flex"><ExternalLink size={12} />{claude ? t('signin.openClaude') : t('signin.openCodex')}</a>
          </div>
          {claude ? (
            <div>
              <p className="text-xs text-text">{t('signin.step2Paste')}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input value={code} onChange={(ev) => setCode(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') void submit(); }} placeholder={t('signin.codePh')} aria-label={t('signin.codePh')} autoComplete="off" spellCheck={false} dir="ltr" disabled={st.status === 'verifying'} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 font-mono text-xs text-text outline-none placeholder:font-sans focus:border-accent" />
                <button onClick={() => void submit()} disabled={!code.trim() || busy || st.status === 'verifying'} className="btn-primary h-8 text-xs">{t('signin.submit')}</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-text">{t('signin.step2Device')}</p>
              {st.code ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="signin-code" dir="ltr">{st.code}</span>
                  <button onClick={copyCode} className="btn-soft" aria-label={t('signin.copy')}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? t('signin.copied') : t('signin.copy')}</button>
                </div>
              ) : <p className="mt-1 flex items-center gap-2 text-xs text-muted"><Loader2 size={13} className="animate-spin" />{t('signin.starting')}</p>}
            </div>
          )}
          <p className="flex items-center gap-2 text-[11.5px] text-muted">
            {(st.status === 'verifying' || !claude) && <Loader2 size={12} className="animate-spin" />}
            {st.status === 'verifying' ? t('signin.verifying') : claude ? t('signin.waitingPaste') : t('signin.waitingDevice')}
          </p>
          {st.message && <p className="font-mono text-[11px] text-warn" dir="ltr"><bdi>{st.message}</bdi></p>}
        </>
      )}
      {error && <p className="text-xs text-danger"><bdi>{error}</bdi></p>}
      <button onClick={() => void cancel()} className="text-xs text-muted hover:text-text">{t('common.cancel')}</button>
    </div>
  );
}
