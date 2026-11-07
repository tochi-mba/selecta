import { useEffect, useRef, useState } from 'react';
import { ApiError, get, MixData, post, VibeCard } from '../api';
import { analysisWords, length, SET_LENGTHS } from '../lib';
import { useLocationText } from '../router';
import { orderOf } from '../state/readiness';
import { EXPLORE_TABS } from '../shell/manifest';
import { Action, Dialog, Problem, Skeleton } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { CurrentMix } from './CurrentMix';
import { buildSummary, MixSetup } from './MixSetup';
import { askToAnalyse, hasStartedAMix, Preparing, READY_NEEDED, rememberStartedAMix, SetupSteps } from './Setup';
import { ViewProps } from './shared';

const GROUPS = ['The moment', 'The mood', 'The sound', 'The journey'];

type Asked = { key: string; name: string; open: boolean; order?: string };

/** The front door. One tap plays something good, and everything can be changed afterwards. */
export function Mixes({ status, mix, mixName, player, setMixData, setView, notify, now, refreshMix, refreshStatus }: ViewProps) {
  const [cards, setCards] = useState<VibeCard[] | null>(null);
  const [songs, setSongs] = useState(12);
  const [building, setBuilding] = useState('');
  const buildingNow = useRef(false);
  const [problem, setProblem] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [cardsAttempt, setCardsAttempt] = useState(0);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [confirming, setConfirming] = useState<Asked | null>(null);
  const here = useLocationText().split('?')[0];
  const { counts } = status;

  useEffect(() => {
    let live = true;
    setCardsFailed(false);
    get<VibeCard[]>('/vibes').then((rows) => { if (live) setCards(rows); }).catch(() => { if (live) setCardsFailed(true); });
    return () => { live = false; };
  }, [counts.analysed, counts.lyrics, counts.ready, cardsAttempt]);

  const start = async ({ key, name, open, order }: Asked) => {
    // nothing plays or changes until the server has said which mix it made
    if (buildingNow.current) return;
    buildingNow.current = true;
    setBuilding(key);
    setProblem('');
    try {
      const data = await post<MixData>(`/vibes/${key}/build?count=${songs}`, undefined, {
        'x-mix-order': order ?? orderOf(mix),
      });
      setMixData(data);
      rememberStartedAMix();
      notify(`${name}: ${data.mix.length} songs.`, true);
      if (open) {
        setView('Edit');
      } else {
        setView('Now');
        void player.playFrom(0);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      setProblem((error as Error).message);
    } finally {
      buildingNow.current = false;
      setBuilding('');
    }
  };

  const keepAsDraft = async (key: string) => {
    if (buildingNow.current) return;
    buildingNow.current = true;
    setBuilding(key);
    setProblem('');
    try {
      const made = await post<{ id: number; name: string; count: number }>(`/vibes/${key}/build?count=${songs}&as_draft=true`);
      notify(`Saved ${made.name} as a draft, with ${made.count} songs. Nothing changed in what’s playing.`);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      buildingNow.current = false;
      setBuilding('');
    }
  };

  const analyse = async () => {
    await askToAnalyse();
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };

  const hero = cards?.find((card) => card.key === 'pick');
  const ready = cards?.filter((card) => card.ready && card.key !== 'pick') ?? [];
  const waiting = cards?.filter((card) => !card.ready && card.key !== 'christmas') ?? [];
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const readinessAvailable = Number.isFinite(counts.ready);
  const readyCount = counts.ready;
  // a mix that's playing or paused is what would be replaced, so that's when to ask
  const replacing = mix.length > 0 && now.phase !== 'idle';
  const ask = (asked: Asked) => {
    const choice = { ...asked, order: orderOf(mix) };
    if (replacing) {
      setConfirming(choice);
      return Promise.resolve();
    }
    return start(choice);
  };

  if (!readinessAvailable) {
    return (
      <main className="page" id="main">
        <h1 className="display">Checking your song readiness.</h1>
        <p className="lede">
          This running Selecta server hasn’t reported how many songs have the cues needed for mixes.
          Restart Selecta to refresh this status. Audio analysis is complete for {counts.analysed};
          {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'}
        </p>
        <div className="row">
          <button onClick={() => setView('Workshop')}>See progress</button>
        </div>
      </main>
    );
  }

  if (readyCount < READY_NEEDED) return <Preparing status={status} onAnalyse={analyse} />;

  const firstMix = !mix.length && !hasStartedAMix();
  return (
    <main className="page mixes" id="main">
      {firstMix && <SetupSteps stage="listen" />}
      <LinkTabs label="Explore" items={EXPLORE_TABS} current={EXPLORE_TABS.some((tab) => tab.path === here) ? here : '/mixes'} />
      {mix.length > 0 && <CurrentMix mix={mix} mixName={mixName} now={now} player={player} setView={setView} />}

      <section className="hero">
        <p className="eyebrow">{firstMix ? 'Your library is ready' : 'Tap and play'}</p>
        <h1 className="display">{hero?.name ?? 'Selecta’s pick'}</h1>
        <p className="lede">{hero?.blurb ?? 'The strongest run it can find through your library.'}</p>
        <div className="row wrap">
          <Action
            className="primary big"
            disabled={!hero?.ready || !!building}
            working="Building…"
            title={replacing ? `Replaces ${mixName}, which you can undo` : undefined}
            run={() => hero && ask({ key: 'pick', name: hero.name, open: false })}
          >
            Play
          </Action>
          <div className="chips" role="group" aria-label="How long, roughly">
            {SET_LENGTHS.map((option) => (
              <button key={option.songs} aria-pressed={songs === option.songs} onClick={() => setSongs(option.songs)}>
                About {option.label}
              </button>
            ))}
          </div>
          <button onClick={() => setCustomizing(true)}>Customize</button>
        </div>
        {hero && !hero.ready && <p className="hint">{hero.name} needs {hero.needs} more mix-ready {hero.needs === 1 ? 'song' : 'songs'} before it can play.</p>}
        <p className="hint build-summary">Next mix: {buildSummary(status.steering)}.</p>
        <p className="hint">
          {songs} songs. How long it really runs depends on where the transitions fall.
          {replacing ? ` Playing a new mix replaces ${mixName}, which you can undo. To keep it playing, use Save as draft.` : ''}
        </p>
      </section>

      {problem && <p className="warn" role="alert">{problem}</p>}

      <section>
        <h2 className="section-title">Pick a feeling</h2>
        <p className="hint">Every one is built from your own songs, fresh each time you press play.</p>
        {cardsFailed && <Problem retry={() => setCardsAttempt((value) => value + 1)}>Couldn’t load mix suggestions. Try again when Selecta is available.</Problem>}
        {!cards && !cardsFailed && <Skeleton variant="cards" lines={4} label="Finding what your library can do" />}
        {GROUPS.map((group) => {
          const inGroup = ready.filter((card) => card.group === group);
          if (!inGroup.length) return null;
          return (
            <div className="vibe-group" key={group}>
              <h3 className="eyebrow">{group}</h3>
              <div className="cards">
                {inGroup.map((card) => (
                  <article className="card" key={card.key} data-vibe={card.key}>
                    <h3>{card.name}</h3>
                    <p>{card.blurb}</p>
                    <p className="artists">{card.artists.join(', ')}</p>
                    <p className="how">
                      {card.tempo ? `${card.tempo[0]}–${card.tempo[1]} BPM · ` : ''}
                      {card.moves}
                    </p>
                    <small className="soft">{card.songs} songs, up to {length(card.seconds)}</small>
                    <div className="row card-actions">
                      <Action className="primary" disabled={!!building} working="Building…" run={() => ask({ key: card.key, name: card.name, open: false })}>Play</Action>
                      <Action className="quiet" disabled={!!building} working="Building…" run={() => ask({ key: card.key, name: card.name, open: true })}>Edit first</Action>
                      <Action className="quiet" disabled={!!building} working="Saving…" aria-label={`Save ${card.name} as a draft`} run={() => keepAsDraft(card.key)}>Save as draft</Action>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {waiting.length > 0 && (
        <section className="waiting">
          <h2 className="section-title">Needs more mix-ready songs</h2>
          <p className="hint">These need songs that have been analysed and have timed lyrics or are instrumental.</p>
          <ul>
            {waiting.map((card) => (
              <li key={card.key}>
                <b>{card.name}</b> <span className="soft">needs {card.needs} more</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {left > 0 && (
        <section className="nudge">
          <p>
            <b>{counts.analysed} of {counts.music} songs have audio analysis; {counts.ready ?? 0} are ready for mixes.</b> The rest will mean more variety and word links. {analysisWords(status.eta?.analysis)}
          </p>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <Action run={analyse}>Analyse the rest</Action>
          )}
        </section>
      )}

      {customizing && <MixSetup status={status} mix={mix} refreshStatus={refreshStatus} notify={notify} onClose={() => setCustomizing(false)} />}
      {confirming && (
        <Dialog
          title={`Replace ${mixName}?`}
          onClose={() => setConfirming(null)}
          footer={(
            <>
              <button onClick={() => setConfirming(null)}>Cancel</button>
              <Action working="Saving…" run={async () => { const { key } = confirming; setConfirming(null); await keepAsDraft(key); }}>Save as draft instead</Action>
              <Action className="primary" working="Building…" run={async () => { const asked = confirming; setConfirming(null); await start(asked); }}>
                {confirming.open ? 'Replace and edit' : 'Replace and play'}
              </Action>
            </>
          )}
        >
          <p>
            <b>{confirming.name}</b> would take over from <b>{mixName}</b>, which is {now.phase === 'paused' ? 'paused' : 'playing'}. You can undo this straight afterwards.
          </p>
          <p className="hint">Saving it as a draft instead leaves what’s playing exactly as it is.</p>
        </Dialog>
      )}
    </main>
  );
}
