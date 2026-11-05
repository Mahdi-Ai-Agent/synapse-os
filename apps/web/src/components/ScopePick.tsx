import { Check, ChevronDown, Orbit } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect } from 'react';
import { useT } from '../i18n';
import { useScopes, type MapScope } from '../lib/maps';
import { useStore } from '../state/store';
import { TypeIcon } from './TypeIcon';

/**
 * Which part of the vault a message works in (spec: docs/UI-DESIGN.md "Scopes"): the core — the mind map plus every
 * map connected to it — or one group of maps cut off from it. Shown only while something is cut off; with every map
 * connected there is one core and nothing to pick.
 */
export function ScopePick({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const scopes = useScopes();
  // A map reconnected while it was the chosen scope: fall back to the core.
  useEffect(() => { if (scopes.length && !scopes.some((x) => x.id === scope)) setScope('mind'); }, [scopes, scope, setScope]);
  if (scopes.length < 2) return null;
  const current = scopes.find((x) => x.id === scope) ?? scopes[0]!;
  const titleOf = (s: MapScope): string => (s.core ? t('scope.core') : s.maps.map((m) => m.title).join(' + '));
  return (
    <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className={`chip scope-pick ${compact ? 'is-compact' : ''} ${current.core ? '' : 'is-island'}`} title={t('scope.hint')} aria-label={t('scope.label')}>
          {current.core ? <Orbit size={13} /> : <TypeIcon type="map" size={13} />}
          {!compact && <span className="max-w-[10rem] truncate utext" dir="auto">{titleOf(current)}</span>}
          <ChevronDown size={11} className="chip-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" sideOffset={6} align="start" collisionPadding={10}>
          <div className="menu-title">{t('scope.label')}</div>
          {scopes.map((s) => (
            <DropdownMenu.Item key={s.id} className="menu-item has-hint" onSelect={() => setScope(s.id)}>
              <span className="menu-icon">{s.core ? <Orbit size={14} /> : <TypeIcon type="map" size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block utext" dir="auto">{titleOf(s)}</span>
                <span className="menu-hint utext" dir="auto">{s.core ? (s.maps.length ? `${t('scope.coreHint')} ${s.maps.map((m) => m.title).join('، ')}` : t('scope.coreAlone')) : t('scope.islandHint')}</span>
              </span>
              {s.id === current.id && <Check size={14} className="shrink-0 text-accent" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
