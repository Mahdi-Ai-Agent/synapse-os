import { Check, ExternalLink, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { fmtNum } from '../lib/format';
import type { LinkPreview } from '../lib/types';
import { useStore } from '../state/store';
import { lastDays, MOOD_EMOJI, MOODS, PLATFORM_STYLE, weekdayInitial } from './meta';

/** A circular progress ring with the number in the middle. */
export function ProgressRing({ value, size = 44, color }: { value: number; size?: number; color: string }) {
  const locale = useStore((s) => s.locale);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <span className="absolute font-display text-[11px] font-bold text-text">{fmtNum(v, locale)}{locale === 'fa' ? '٪' : '%'}</span>
    </span>
  );
}

/** Habit check-ins of the last `days` days as dots; today can be toggled. */
export function StreakDots({ checkins, today, days = 7, color, onToggleToday, markToday = true }: { checkins: readonly string[]; today: string; days?: number; color: string; onToggleToday?: () => void; markToday?: boolean }) {
  const locale = useStore((s) => s.locale);
  const set = new Set(checkins);
  return (
    <span className="streak" dir="ltr" style={{ '--chip': color } as React.CSSProperties}>
      {(locale === 'fa' ? [...lastDays(days, today)].reverse() : lastDays(days, today)).map((d) => {
        const done = set.has(d);
        const isToday = markToday && d === today;
        return (
          <button key={d} type="button" disabled={!isToday || !onToggleToday} onClick={(e) => { e.stopPropagation(); onToggleToday?.(); }}
            className={`streak-dot ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''}`} title={d}>
            <span>{weekdayInitial(d, locale)}</span>
          </button>
        );
      })}
    </span>
  );
}

export function MoodPicker({ value, onChange }: { value: string | undefined; onChange: (m: string | null) => void }) {
  const t = useT();
  return (
    <span className="flex gap-1">
      {MOODS.map((m) => (
        <button key={m} type="button" onClick={() => onChange(value === m ? null : m)} className={`mood-btn ${value === m ? 'is-on' : ''}`} title={t(`mood.${m}` as TKey)} aria-label={t(`mood.${m}` as TKey)}>{MOOD_EMOJI[m]}</button>
      ))}
    </span>
  );
}

/** Preview of a saved link: its image (from the frontmatter or a fetched preview), or a platform-coloured tile. */
export function MediaThumb({ url, image, platform, kind, large = false }: { url?: string; image?: string; platform?: string; kind?: string; large?: boolean }) {
  const t = useT();
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (image || !url) return;
    let alive = true;
    api.preview(url).then((p) => { if (alive) setPreview(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, [url, image]);
  const src = !broken ? image ?? preview?.image : undefined;
  const style = PLATFORM_STYLE[platform ?? 'web'] ?? PLATFORM_STYLE['web']!;
  const playable = kind === 'video' || kind === 'reel' || kind === 'podcast';
  return (
    <span className={`media-thumb ${large ? 'large' : ''} ${kind === 'reel' ? 'is-reel' : ''}`} style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}>
      {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      <span className="media-badge">{style.label}{kind ? ` · ${t(`rkind.${kind}` as TKey)}` : ''}</span>
      {playable && <span className="media-play"><Play size={large ? 22 : 15} fill="currentColor" /></span>}
    </span>
  );
}

export function OpenLink({ url }: { url: string }) {
  const t = useT();
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="btn-soft">
      <ExternalLink size={13} />{t('kind.open')}
    </a>
  );
}

/** A round "done" toggle (tasks, today's habit check-in). */
export function DoneToggle({ done, onToggle, label, color }: { done: boolean; onToggle: () => void; label: string; color: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`done-toggle ${done ? 'is-done' : ''}`} style={{ '--chip': color } as React.CSSProperties} aria-pressed={done} aria-label={label} title={label}>
      {done && <Check size={14} strokeWidth={3} />}
    </button>
  );
}

/** First letter avatar in the node's colour. */
export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return <span className="avatar" style={{ '--cat': color, width: size, height: size, fontSize: size * 0.42 } as React.CSSProperties}><bdi>{[...name.trim()][0] ?? '?'}</bdi></span>;
}
