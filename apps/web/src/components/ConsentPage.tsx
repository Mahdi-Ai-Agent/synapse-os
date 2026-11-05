import { Cable, Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { translate, useT, type TKey } from '../i18n';
import { api, ConsentError } from '../lib/api';
import type { AuthStatus, ConsentRequest } from '../lib/types';
import { useStore } from '../state/store';
import { AuthForm } from './AuthScreen';

/** `template` with `{key}` replaced by a node (an app name or a host, isolated so its direction cannot leak). */
function fill(template: string, key: string, node: ReactNode): ReactNode {
  const [before, after] = template.split(`{${key}}`);
  return <>{before}{node}{after}</>;
}

const hostOf = (url: string): string => {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : u.protocol.replace(/:$/, ''); } catch { return url; }
};

/**
 * The page an AI app opens to connect (`/oauth/authorize`, docs/UI-DESIGN.md "Connections"): the owner signs in when
 * this browser is not signed in, sees which app asks and where the answer goes, may let it write too, and is sent back
 * to the app with the answer. Every check happens again on the server when the owner answers.
 */
export default function ConsentPage() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [ask, setAsk] = useState<ConsentRequest | null>(null);
  const [problem, setProblem] = useState<{ message: string; redirect: string | null } | null>(null);
  const [write, setWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const query = location.search;

  useEffect(() => {
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    document.title = translate(locale, 'consent.pageTitle');
  }, [locale]);

  useEffect(() => {
    const fail = (e: unknown): void => setProblem({ message: (e as Error).message, redirect: e instanceof ConsentError ? e.redirect : null });
    api.authStatus().then(async (s) => {
      setStatus(s);
      if (!s.authenticated) return;
      api.vault().then((v) => { if (v.exists) useStore.getState().setLocale(v.settings.locale); }).catch(() => undefined);
      try {
        const r = await api.consentRequest(query);
        setAsk(r);
        setWrite(r.write);
      } catch (e) { fail(e); }
    }).catch(fail);
  }, [query]);

  const answer = async (allow: boolean): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.consentDecide({ query, allow, write: allow && write });
      setLeaving(hostOf(r.redirect));
      location.assign(r.redirect);
    } catch (e) {
      setProblem({ message: (e as Error).message, redirect: e instanceof ConsentError ? e.redirect : null });
      setBusy(false);
    }
  };

  const shell = (children: ReactNode): ReactNode => (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="glass w-full max-w-md space-y-4 p-6">{children}</div>
    </div>
  );
  const Host = ({ host }: { host: string }) => <bdi dir="ltr" className="font-mono text-[0.95em] text-text">{host}</bdi>;

  if (problem) {
    return shell(
      <>
        <div className="text-center">
          <ShieldAlert className="mx-auto mb-3 text-danger" size={28} />
          <h1 className="text-lg font-semibold">{t('consent.invalid')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted"><bdi dir="auto">{problem.message}</bdi></p>
        </div>
        {problem.redirect && (
          <button onClick={() => location.assign(problem.redirect!)} className="btn-soft w-full justify-center">
            {fill(t('consent.back'), 'host', <Host host={hostOf(problem.redirect)} />)}
          </button>
        )}
      </>,
    );
  }
  if (leaving) return shell(<p className="flex items-center justify-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />{fill(t('consent.leaving'), 'host', <Host host={leaving} />)}</p>);
  if (!status) return shell(<p className="text-center text-sm text-muted">{t('common.loading')}</p>);
  if (!status.authenticated) {
    if (!status.account) {
      return shell(
        <div className="text-center">
          <Cable className="mx-auto mb-3 text-accent" size={28} />
          <h1 className="text-lg font-semibold">{t('consent.pageTitle')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t('consent.noAccount')}</p>
          <a href="/" className="btn-soft mt-4 inline-flex">{t('consent.openSynapse')}</a>
        </div>,
      );
    }
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
        <p className="max-w-sm text-center text-sm leading-relaxed text-muted">{t('consent.signInFirst')}</p>
        <AuthForm setup={false} needsCode={false} />
      </div>
    );
  }
  if (!ask) return shell(<p className="text-center text-sm text-muted">{t('common.loading')}</p>);

  const can: TKey[] = ['consent.canSearch', 'consent.canRead', 'consent.canOwner'];
  return shell(
    <>
      <div className="text-center">
        <Cable className="mx-auto mb-3 text-accent" size={28} />
        <h1 className="text-lg font-semibold leading-snug">{fill(t('consent.title'), 'app', <bdi className="text-accent">{ask.app}</bdi>)}</h1>
        {ask.owner && <p className="mt-1 text-xs text-muted">{t('settings.signedInAs')}<bdi className="font-medium text-text">{ask.owner}</bdi></p>}
      </div>
      <div className="space-y-1.5 text-sm">
        <p className="text-muted">{t('consent.canTitle')}</p>
        <ul className="list-disc space-y-1 ps-5 leading-relaxed">{can.map((k) => <li key={k}>{t(k)}</li>)}</ul>
      </div>
      {ask.write && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="mt-0.5 accent-accent" />
          <span className="leading-relaxed">{t('consent.write')}<span className="mt-0.5 block text-xs text-muted">{t('consent.writeHint')}</span></span>
        </label>
      )}
      {ask.local && <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed text-muted">{t('consent.localWarning')}</p>}
      <p className="text-xs leading-relaxed text-muted">{fill(t('consent.returnsTo'), 'host', <Host host={ask.returnsTo} />)} {t('consent.revokeHint')}</p>
      <div className="flex gap-2">
        <button onClick={() => void answer(true)} disabled={busy} className="btn-primary flex-1 justify-center">{t('consent.allow')}</button>
        <button onClick={() => void answer(false)} disabled={busy} className="btn-soft flex-1 justify-center">{t('consent.deny')}</button>
      </div>
    </>,
  );
}
