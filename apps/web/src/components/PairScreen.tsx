import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { extractToken, getPairToken, setPairToken } from '../lib/pairing';

/** Pairing with a link or token: the other way in on the sign-in screen (`AuthScreen`). */
export function PairScreen({ onBack }: { onBack?: () => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hadToken = getPairToken() !== null;

  const submit = (): void => {
    const token = extractToken(value);
    if (!token) { setError(t('pair.invalid')); return; }
    setPairToken(token);
    location.replace(location.pathname);
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="glass w-full max-w-md p-6 text-center">
        <Smartphone className="mx-auto mb-3 text-accent" size={28} />
        <h1 className="text-xl font-semibold">{t('pair.title')}</h1>
        <p className="mt-2 text-sm text-muted">{hadToken ? t('pair.expired') : t('pair.hint')}</p>
        {hadToken && <p className="mt-1 text-xs text-muted">{t('pair.hint')}</p>}
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={t('pair.placeholder')}
          className="mt-4 w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('pair.placeholder')}
        />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <button onClick={submit} disabled={!value.trim()} className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40">{t('pair.submit')}</button>
        {onBack && <button onClick={onBack} className="mt-3 block w-full text-center text-xs text-muted hover:text-text">{t('auth.useLogin')}</button>}
      </div>
    </div>
  );
}
