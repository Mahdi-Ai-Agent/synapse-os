import { Cable, Copy, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { fmtDateTime, inputDir } from '../lib/format';
import type { ConnectionsList } from '../lib/types';
import { useStore } from '../state/store';

type AppId = 'claude' | 'chatgpt' | 'claudeCode' | 'codex' | 'other';
const APPS: Array<{ id: AppId; label: string }> = [
  { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' }, { id: 'claudeCode', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }, { id: 'other', label: '…' },
];

/** A loopback or LAN address: other AI apps on the web cannot reach it (they connect from their own servers). */
function privateAddress(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1';
  } catch { return false; }
}

/**
 * Settings → Connections (docs/UI-DESIGN.md "Connections"): this Synapse's MCP address, how to add it in each AI app,
 * the apps connected now (with what they may do and when they were last used) and personal keys for apps that take a
 * bearer token instead of signing in.
 */
export function ConnectionsCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const [data, setData] = useState<ConnectionsList | null>(null);
  const [app, setApp] = useState<AppId>('claude');
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [keyWrite, setKeyWrite] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = (): void => { api.connections().then(setData).catch(() => undefined); };
  useEffect(load, []);
  if (!data) return null;

  const copy = (s: string): void => { navigator.clipboard.writeText(s).then(() => setToast(t('settings.copied')), () => setToast(s)); };
  const disconnect = async (id: string): Promise<void> => {
    try { await api.removeConnection(id); setToast(t('connections.removed')); load(); } catch (e) { setToast((e as Error).message); }
  };
  const makeKey = async (): Promise<void> => {
    try {
      const r = await api.createKey({ name: name.trim(), write: keyWrite });
      setFresh(r.key); setMaking(false); setName(''); setKeyWrite(false); load();
    } catch (e) { setToast((e as Error).message); }
  };

  const url = data.mcpUrl;
  const command: Partial<Record<AppId, string>> = {
    claudeCode: `claude mcp add --transport http --scope user synapse ${url}`,
    codex: `codex mcp add synapse --url ${url}`,
  };
  const Code = ({ text }: { text: string }) => (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-black/20 px-2.5 py-1.5">
      <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">{text}</code>
      <button onClick={() => copy(text)} className="shrink-0 text-muted hover:text-text" title={t('settings.copy')} aria-label={t('settings.copy')}><Copy size={13} /></button>
    </div>
  );

  return (
    <section className="card text-sm">
      <h3 className="card-title flex items-center gap-2"><Cable size={15} className="text-accent" />{t('connections.title')}</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('connections.hint')}</p>
      <div className="text-xs text-muted">{t('connections.address')}</div>
      <Code text={url} />
      {privateAddress(url) && <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{t('connections.localOnly')}</p>}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist">
        {APPS.map((a) => (
          <button key={a.id} role="tab" aria-selected={app === a.id} onClick={() => setApp(a.id)} className={`chip-toggle ${app === a.id ? 'is-on' : ''}`}>
            {a.id === 'other' ? t('connections.otherApps') : a.label}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-line p-3 text-xs leading-relaxed">
        <p>{t(`connections.steps.${app}` as TKey)}</p>
        {command[app] && <Code text={command[app]!} />}
        {app === 'claudeCode' && <p className="mt-2 text-muted">{t('connections.steps.claudeCode2')}</p>}
        {app === 'codex' && <Code text="codex mcp login synapse" />}
      </div>

      <h4 className="mb-1.5 mt-4 text-xs font-semibold text-muted">{t('connections.connected')}</h4>
      {data.connections.length === 0 && <p className="text-xs text-muted">{t('connections.none')}</p>}
      <ul className="space-y-1">
        {data.connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1 py-1 text-xs">
            {c.kind === 'key' ? <KeyRound size={13} className="shrink-0 text-muted" /> : <Cable size={13} className="shrink-0 text-muted" />}
            <bdi className="font-medium text-text">{c.name}</bdi>
            {c.kind === 'key' ? <span dir="ltr" className="font-mono text-[11px] text-muted">…{c.hint}</span> : <span dir="ltr" className="text-[11px] text-muted">{c.via}</span>}
            <span className="pill">{c.write ? t('connections.readWrite') : t('connections.readOnly')}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{c.usedAt ? `${t('connections.lastUsed')} ${fmtDateTime(c.usedAt, locale)}` : t('connections.notUsed')}</span>
            <button onClick={() => void disconnect(c.id)} className="flex shrink-0 items-center gap-1 text-muted hover:text-danger" title={c.kind === 'key' ? t('connections.deleteKey') : t('connections.disconnect')}>
              <Trash2 size={12} />{c.kind === 'key' ? t('connections.deleteKey') : t('connections.disconnect')}
            </button>
          </li>
        ))}
      </ul>

      {fresh && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed">
          <p>{t('connections.keyOnce')}</p>
          <Code text={fresh} />
          <button onClick={() => setFresh(null)} className="btn-soft mt-2">{t('connections.keySaved')}</button>
        </div>
      )}
      {making ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('connections.keyName')} aria-label={t('connections.keyName')} dir={inputDir(name, locale)} maxLength={80} className="field h-8 w-44 py-0 text-xs" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={keyWrite} onChange={(e) => setKeyWrite(e.target.checked)} className="accent-accent" />{t('connections.keyWrite')}
          </label>
          <button onClick={() => void makeKey()} disabled={!name.trim()} className="btn-soft">{t('connections.makeKey')}</button>
          <button onClick={() => { setMaking(false); setName(''); }} className="btn-soft">{t('common.cancel')}</button>
        </div>
      ) : (
        <button onClick={() => { setMaking(true); setFresh(null); }} className="btn-soft mt-3"><KeyRound size={12} />{t('connections.newKey')}</button>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-muted">{t('connections.keyHint')} {t('connections.passwordNote')}</p>
    </section>
  );
}
