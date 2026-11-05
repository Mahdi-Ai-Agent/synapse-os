import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { ApiError, api } from '../lib/api';
import { inputDir } from '../lib/format';
import { setPairToken } from '../lib/pairing';
import type { AuthStatus } from '../lib/types';
import { useStore } from '../state/store';
import { PairScreen } from './PairScreen';

/**
 * Shown instead of the app when the server answers 401 (docs/ARCHITECTURE.md "Access control"): the first-run setup
 * while this Synapse has no account, sign-in once it has one, and a pair link as the other way in.
 */
export function AuthScreen() {
  const t = useT();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    api.authStatus().then(setStatus).catch(() => setStatus({ account: true, authenticated: false, session: false, username: null, needsCode: false }));
  }, []);
  if (pairing) return <PairScreen onBack={() => setPairing(false)} />;
  if (!status) return <div className="flex h-full items-center justify-center text-muted">{t('common.loading')}</div>;
  return <AuthForm setup={!status.account} needsCode={status.needsCode} onPair={() => setPairing(true)} />;
}

const FIELD = 'w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-accent';

/** The account form: create (username, password twice, the setup code when asked) or sign in (username, password). */
export function AuthForm({ setup, needsCode, onPair, onDone }: { setup: boolean; needsCode: boolean; onPair?: () => void; onDone?: (token: string) => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (setup && password.length < 8) { setError(t('auth.tooShort')); return; }
    if (setup && password !== confirm) { setError(t('auth.mismatch')); return; }
    setBusy(true);
    setError(null);
    try {
      const r = setup ? await api.authSetup({ username, password, ...(needsCode ? { code } : {}) }) : await api.authLogin({ username, password });
      if (onDone) { onDone(r.token); setBusy(false); return; }
      setPairToken(r.token);
      location.replace(location.pathname + location.search + location.hash);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 429 ? t('auth.tooMany') : status === 403 ? t('auth.badCode') : status === 401 ? t('auth.wrong') : status === 409 ? t('auth.exists') : (err as Error).message);
      if (status === 409) setTimeout(() => location.reload(), 1500);
      setBusy(false);
    }
  };

  const ready = username.trim() && password && (!setup || confirm) && (!setup || !needsCode || code.trim());
  return (
    <div className={onDone ? '' : 'flex h-full items-center justify-center p-6'}>
      <form onSubmit={(e) => void submit(e)} className={onDone ? 'space-y-2' : 'glass w-full max-w-sm space-y-3 p-6'}>
        {!onDone && (
          <div className="text-center">
            {setup ? <ShieldCheck className="mx-auto mb-3 text-accent" size={28} /> : <LockKeyhole className="mx-auto mb-3 text-accent" size={28} />}
            <h1 className="text-xl font-semibold">{setup ? t('auth.setupTitle') : t('auth.loginTitle')}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">{setup ? t('auth.setupHint') : t('auth.loginHint')}</p>
          </div>
        )}
        <label className="block text-xs text-muted">{t('auth.username')}
          <input value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }} dir={inputDir(username, locale)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!onDone} className={`mt-1 ${FIELD}`} />
        </label>
        <label className="block text-xs text-muted">{t('auth.password')}
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} dir="ltr" autoComplete={setup ? 'new-password' : 'current-password'} className={`mt-1 ${FIELD}`} />
        </label>
        {setup && (
          <label className="block text-xs text-muted">{t('auth.confirm')}
            <input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); }} dir="ltr" autoComplete="new-password" className={`mt-1 ${FIELD}`} />
          </label>
        )}
        {setup && needsCode && (
          <label className="block text-xs text-muted">{t('auth.code')}
            <input value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} dir="ltr" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" className={`mt-1 font-mono ${FIELD}`} />
            <span className="mt-1 block leading-relaxed">{t('auth.codeHint')}</span>
          </label>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" disabled={!ready || busy} className="btn-primary w-full justify-center">{setup ? t('auth.create') : t('auth.signIn')}</button>
        {onPair && <button type="button" onClick={onPair} className="block w-full text-center text-xs text-muted hover:text-text">{t('auth.usePair')}</button>}
      </form>
    </div>
  );
}
