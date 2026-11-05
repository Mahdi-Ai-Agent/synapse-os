import { Check, Copy, QrCode, RefreshCw, Smartphone, Unlink, Wifi, WifiOff } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { setPairToken } from '../lib/pairing';
import type { PairingInfo } from '../lib/types';
import { useStore } from '../state/store';

/**
 * Settings → Phone: LAN access switch, the detected LAN URL(s), and (desktop only) the pairing QR code, link and
 * token. On a paired phone it shows the pairing state and an "unpair" button instead. Spec: docs/UI-DESIGN.md.
 */
export function PhonePairing() {
  const t = useT();
  const setSettings = useStore((s) => s.setSettings);
  const setToast = useStore((s) => s.setToast);
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** This browser is signed in with the account: the Account card covers it, there is nothing to pair. */
  const [session, setSession] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const i = await api.pairing();
      setInfo(i); setError(null);
      setUrl((u) => (u && i.urls.includes(u) ? u : i.urls[0] ?? null));
      if (!i.fromLoopback) setSession((await api.authStatus()).session);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);

  const pairUrl = info?.token && url ? `${url}/#pair=${info.token}` : null;
  useEffect(() => {
    if (!pairUrl) { setQr(null); return; }
    let alive = true;
    QRCode.toDataURL(pairUrl, { width: 232, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f17', light: '#ffffff' } })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [pairUrl]);

  const toggleLan = async (on: boolean): Promise<void> => {
    setBusy(true);
    try {
      setSettings(await api.putSettings({ server: { lanAccess: on } }));
      // The server re-binds right after answering; give it a moment, then read the live state.
      await new Promise((r) => setTimeout(r, 900));
      await load();
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  const rotate = async (): Promise<void> => {
    if (!window.confirm(t('settings.rotateConfirm'))) return;
    setBusy(true);
    try { await api.rotatePairing(); await load(); setToast(t('settings.rotated')); } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async (what: string, text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { setToast(text); }
  };
  const unpair = (): void => { setPairToken(null); location.replace(location.pathname); };

  const lanLive = info?.bound ? info.bound.lan : info?.lanAccess ?? false;
  const pending = info ? info.lanAccess !== lanLive : false;

  if (info && !info.fromLoopback && session) return null;
  return (
    <section className="card text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Smartphone size={14} className="text-muted" />
        <h3 className="card-title mb-0">{t('settings.phone')}</h3>
        <span className="flex-1" />
        <button onClick={() => void load()} className="rounded-md p-1 text-muted hover:text-text" title={t('common.refresh')}><RefreshCw size={12} /></button>
      </div>
      <p className="mb-3 text-xs text-muted">{t('settings.phoneHint')}</p>
      {error && <p className="mb-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{error}</p>}
      {info && !info.fromLoopback && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-ok"><Check size={14} />{t('settings.pairedHere')}</p>
          <p className="text-xs text-muted">{t('settings.pairFromDesktop')}</p>
          <button onClick={unpair} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-danger"><Unlink size={12} />{t('settings.unpair')}</button>
        </div>
      )}
      {info?.fromLoopback && (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={info.lanAccess} disabled={busy} onChange={(e) => void toggleLan(e.target.checked)} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t('settings.lanAccess')}</span>
                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${lanLive ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}>{lanLive ? <Wifi size={11} /> : <WifiOff size={11} />}{lanLive ? t('settings.lanOn') : t('settings.lanOff')}</span>
              </span>
              <span className="mt-1 block text-xs text-muted">{t('settings.lanAccessHint')}</span>
              {info.bound?.pinned && <span className="mt-1 block text-xs text-warn">{t('settings.lanPinned')}</span>}
              {pending && !info.bound?.pinned && <span className="mt-1 block text-xs text-warn">{t('settings.lanPending')}</span>}
            </span>
          </label>

          {info.urls.length === 0 && <p className="rounded-lg bg-warn/10 p-2 text-xs text-warn">{t('settings.noLan')}</p>}
          {info.urls.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {info.urls.map((u) => <button key={u} onClick={() => setUrl(u)} className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${u === url ? 'border-accent text-accent' : 'border-line text-muted'}`} dir="ltr">{u}</button>)}
            </div>
          )}

          {lanLive && pairUrl && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="mx-auto shrink-0 rounded-2xl bg-white p-2 sm:mx-0">
                {qr ? <img src={qr} width={232} height={232} alt={t('settings.pairUrl')} className="block" /> : <div className="flex h-[232px] w-[232px] items-center justify-center text-bg"><QrCode size={32} /></div>}
              </div>
              <div className="min-w-0 flex-1 space-y-3 text-xs">
                <p className="text-muted">{t('settings.scanHint')}</p>
                <Row label={t('settings.openUrl')} value={url ?? ''} copied={copied === 'url'} onCopy={() => void copy('url', url ?? '')} t={t} />
                <Row label={t('settings.pairUrl')} value={pairUrl} copied={copied === 'pair'} onCopy={() => void copy('pair', pairUrl)} t={t} />
                <Row label={t('settings.pairToken')} value={info.token ?? ''} copied={copied === 'token'} onCopy={() => void copy('token', info.token ?? '')} t={t} />
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => void rotate()} disabled={busy} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-muted hover:text-text disabled:opacity-40"><RefreshCw size={12} />{t('settings.rotateToken')}</button>
                </div>
                <p className="text-muted">{t('settings.firewallHint')}</p>
              </div>
            </div>
          )}
          {lanLive && !pairUrl && info.urls.length > 0 && <p className="text-xs text-muted">{t('common.loading')}</p>}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, copied, onCopy, t }: { label: string; value: string; copied: boolean; onCopy: () => void; t: (k: 'settings.copy' | 'settings.copied') => string }) {
  return (
    <div>
      <div className="mb-0.5 text-muted">{label}</div>
      <div className="flex items-center gap-1 rounded-md border border-line bg-bg2 px-2 py-1">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text" dir="ltr" title={value}>{value}</code>
        <button onClick={onCopy} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:text-text" title={t('settings.copy')}>{copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}<span>{copied ? t('settings.copied') : t('settings.copy')}</span></button>
      </div>
    </div>
  );
}
