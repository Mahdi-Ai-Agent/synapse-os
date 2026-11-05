import { Loader2, Map as MapIcon, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { fmtNum } from '../lib/format';
import { useMaps } from '../lib/maps';
import { useStore } from '../state/store';
import { OpenInChat, useReviewRun } from '../components/ReviewRun';
import { Markdown, useResolve } from '../components/Markdown';
import { Card, CardTitle, Empty } from '../components/ui';

/** What the brain sees in you (`memory/insights.md`, written by `/insight`) and what it keeps about you (`memory/profile.md`). */
export function MeView() {
  const t = useT();
  const resolve = useResolve();
  const live = useStore((s) => s.run);
  const [insights, setInsights] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<string | null | undefined>(undefined);
  const { run, running, busy, threadId } = useReviewRun();
  const settledInsight = live?.mode === 'insight' && live.status === 'done';
  useEffect(() => {
    api.memory('insights').then(setInsights).catch(() => setInsights(null));
    api.memory('profile').then(setProfile).catch(() => setProfile(null));
  }, [settledInsight]);
  return (
    <div className="view-body view-wide">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t('coach.me')}</h1>
          <p className="view-sub">{t('me.hint')}</p>
        </div>
      </header>
      <div className="guide-grid mt-6">
      <Card accent="#f59e7b">
        <CardTitle color="#f59e7b">{t('coach.insight')}</CardTitle>
        {insights ? <div className="reading"><Markdown text={insights} resolve={resolve} /></div> : <Empty>{t('coach.noInsight')}</Empty>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void run('insight', t('coach.makeInsight'))} disabled={busy} className="btn-primary">
            {running === 'insight' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{running === 'insight' ? t('coach.running') : insights ? t('coach.refreshInsight') : t('coach.makeInsight')}
          </button>
          {running === 'insight' && <OpenInChat threadId={threadId} />}
        </div>
      </Card>
      <div className="space-y-4">
        <CharacterCard />
        <Card>
          <CardTitle>{t('coach.profile')}</CardTitle>
          {profile ? <div className="reading"><Markdown text={profile} resolve={resolve} /></div> : <Empty>{t('coach.profileEmpty')}</Empty>}
          <p className="mt-3 text-xs leading-relaxed text-muted">{t('coach.profileHint')}</p>
        </Card>
      </div>
      </div>
    </div>
  );
}

/** The character map (UI-DESIGN "Maps"): built by the brain from the vault, shown on the mind map, rebuilt from here. */
function CharacterCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setView = useStore((s) => s.setView);
  const requestFly = useStore((s) => s.requestFly);
  const { character, color } = useMaps();
  const { run, running, busy, threadId } = useReviewRun();
  const accent = character ? color(character.id) : '#f2c14e';
  return (
    <Card accent={accent}>
      <CardTitle color={accent}>{t('maps.character')}</CardTitle>
      {character ? (
        <p className="text-sm leading-relaxed text-text">{t('maps.characterHas').replace('{areas}', fmtNum(character.areas, locale)).replace('{n}', fmtNum(character.size - character.areas, locale))}</p>
      ) : <Empty>{t('maps.characterMissing')}</Empty>}
      <p className="mt-2 text-xs leading-relaxed text-muted">{t('maps.characterHint')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void run('character', t('maps.buildCharacter'))} disabled={busy} className="btn-primary">
          {running === 'character' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{running === 'character' ? t('coach.running') : character ? t('maps.rebuild') : t('maps.build')}
        </button>
        {character && <button onClick={() => { setView('graph'); requestFly([], undefined, character.id); }} className="btn-soft"><MapIcon size={14} />{t('maps.show')}</button>}
        {running === 'character' && <OpenInChat threadId={threadId} />}
      </div>
    </Card>
  );
}
