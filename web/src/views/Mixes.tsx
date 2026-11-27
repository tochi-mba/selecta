import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { answerWithin, ApiError, MixData, VibeCard } from '../api';
import { useApi, useRequest } from '../requestContext';
import { flagOn, useFlags } from '../flags';
import { analysisWords, length, SET_LENGTHS } from '../lib';
import { navigate, useLocationText } from '../router';
import { sceneTransitionsSupported, sceneTransitionsWanted } from '../shell/sceneTransition';
import { orderOf } from '../state/readiness';
import { operationId } from '../state/async';
import { exploreTabs, listed } from '../shell/manifest';
import { PageLink } from '../shell/PageLink';
import { Action, Dialog, Problem, Skeleton } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { CurrentMix } from './CurrentMix';
import { buildSummary, MixSetup } from './MixSetup';
import { MixIntentGuide, ScopeTag, scopedSettings } from './MixIntent';
import { VibeMotif } from '../ui/MusicObjects';
import { Icon } from '../ui/Icon';
import { askToAnalyse, hasStartedAMix, Preparing, READY_NEEDED, rememberStartedAMix, SetupSteps } from './Setup';
import { ViewProps } from './shared';
import { words } from '../copy';
import { QuickMix } from '../cloud/QuickMix';
import { announceBuilt } from './BuildMoment';

const GROUPS = ['The moment', 'The mood', 'The sound', 'The journey'];

type Asked = { key: string; name: string; open: boolean; order?: string };

// EX-0117-02: the chosen length is kept in this browser, like the other shaping choices,
// so a new visit starts where the listener left it. Anything unexpected falls back to 30 min.
const LENGTH_KEY = 'selecta.mixLength';
/** How long Play waits for a mix to be built before it says so and can be pressed again. */
const BUILD_LIMIT_MS = 90_000;
function rememberedLength(): number {
  if (!flagOn('mixes.shaping.remember_length')) return SET_LENGTHS[0].songs;
  try {
    const saved = Number(window.localStorage.getItem(LENGTH_KEY));
    return SET_LENGTHS.some((option) => option.songs === saved) ? saved : SET_LENGTHS[0].songs;
  } catch {
    return SET_LENGTHS[0].songs;
  }
}
function rememberLength(songs: number) {
  if (!flagOn('mixes.shaping.remember_length')) return;
  try { window.localStorage.setItem(LENGTH_KEY, String(songs)); } catch { /* not remembered is fine */ }
}

/** The front door. One tap plays something good, and everything can be changed afterwards. */
export function Mixes({ status, mix, mixName, player, setMixData, setView, notify, now, refreshMix, refreshStatus, request, readyNeeded = READY_NEEDED, analysisAvailable = true, transitionEditingAvailable = true, startedAMix, playOn, studioLayout = analysisAvailable }: ViewProps & { studioLayout?: boolean }) {
  // ADR-0462: this page's own reads and writes go through the injected request, never the local client.
  const via = useRequest(request);
  const { get, post } = useApi(via);
  const [cards, setCards] = useState<VibeCard[] | null>(null);
  const [songs, setSongsState] = useState(rememberedLength);
  const setSongs = (next: number) => { setSongsState(next); rememberLength(next); };
  const [building, setBuilding] = useState('');
  const buildingNow = useRef(false);
  const hereNow = useRef(true);
  useEffect(() => {
    hereNow.current = true;
    return () => { hereNow.current = false; };
  }, []);
  const operations = useRef(new Map<string, string>());
  const [problem, setProblem] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [feelingGroup, setFeelingGroup] = useState('All');
  const [cardsAttempt, setCardsAttempt] = useState(0);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [confirming, setConfirming] = useState<Asked | null>(null);
  const here = useLocationText().split('?')[0];
  const { counts } = status;
  const on = useFlags();
  // the setup only opens when there's something in it to shape
  const shaping = on('mixes.shaping') && (on('mixes.shaping.feel') || on('mixes.shaping.energy_arc') || on('mixes.shaping.destination') || on('mixes.shaping.stem_moves'));

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
    // which control is working: Play is the idea's key, Shape first adds :open, Save draft adds :draft
    setBuilding(open ? `${key}:open` : key);
    setProblem('');
    const expected = order ?? orderOf(mix);
    const signature = JSON.stringify([key, songs, expected, open]);
    const operation = operations.current.get(signature) ?? operationId('build');
    operations.current.set(signature, operation);
    try {
      // A build that never answers frees Play after the limit; pressing again sends the same operation
      // id, so the server answers with the mix it made rather than making a second. One that answers
      // late only brings the current mix up to date: it never steals playback.
      const data = await answerWithin(post<MixData>(`/vibes/${key}/build?count=${songs}`, undefined, {
        'x-mix-order': expected,
        'x-operation-id': operation,
      }), BUILD_LIMIT_MS, setMixData);
      operations.current.delete(signature);
      // Reconcile the server's actual current mix even after navigating away.
      // A late request must not steal route or playback focus from a new task.
      setMixData(data);
      rememberStartedAMix();
      if (hereNow.current) {
        const actual = data.mix.length;
        const duration = data.mix.reduce((seconds, item) => seconds + item.duration, 0);
        // a browser mix says what is playing; the local build also says how it compares with what was asked
        const counted = `${actual} ${actual === 1 ? 'song' : 'songs'}`;
        // while the picker asks where it plays, the question is asked once, there
        if (!playOn?.ask) notify(analysisAvailable ? `${name}: generated ${actual} of ${songs} requested songs, about ${length(duration)} of source audio before transitions. Review the actual order in Edit.`
          // ADR-0475 R8: never claim it plays here when another device makes the sound
          : playOn ? (playOn.ask ? `Your new mix: ${counted}. Choose where it plays.` : playOn.now ? `Your new mix: ${counted}. Starting it on ${playOn.name}.` : `Your new mix is ready: ${counted}. ${playOn.name} is still playing.`)
            : `Your new mix is playing: ${counted}.`, true);
        if (open) {
          setView('Edit');
        } else {
          // the real plan, handed to Listen's build moment; it draws over Listen and waits for nothing
          announceBuilt(data.mix);
          // ADR-0477: the current mix card is redrawn with the new mix at once, so its face is the
          // one that travels into Listen's cover; without page transitions the page changes at once
          const face = sceneTransitionsSupported() && sceneTransitionsWanted() ? builtFace(data) : null;
          if (face) navigate('/listen', { share: [[face, 'player-art']] });
          else setView('Now');
          // the music never waits for the page's animation
          void player.playFrom(0);
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.code !== 'answer_timeout') operations.current.delete(signature);
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      if (hereNow.current) setProblem((error as Error).message);
      return false; // said here, so the button draws no tick
    } finally {
      buildingNow.current = false;
      setBuilding('');
    }
  };

  /** The current mix card's face, drawn with the mix just built. */
  const builtFace = (data: MixData): Element | null => {
    flushSync(() => setMixData(data));
    return document.querySelector('main#main .carry-on .mix-art');
  };

  const keepAsDraft = async (key: string) => {
    if (buildingNow.current) return;
    buildingNow.current = true;
    setBuilding(`${key}:draft`);
    setProblem('');
    const signature = JSON.stringify([key, songs, 'draft']);
    const operation = operations.current.get(signature) ?? operationId('draft');
    operations.current.set(signature, operation);
    try {
      const made = await answerWithin(post<{ id: number; name: string; count: number }>(
        `/vibes/${key}/build?count=${songs}&as_draft=true`,
        undefined,
        { 'x-operation-id': operation },
      ), BUILD_LIMIT_MS);
      operations.current.delete(signature);
      if (hereNow.current) notify(`Saved ${made.name} as a draft: ${made.count} of ${songs} requested songs. Your current playback was not changed.`);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.code !== 'answer_timeout') operations.current.delete(signature);
      if (hereNow.current) setProblem((error as Error).message);
      return false; // said here, so the button draws no tick
    } finally {
      buildingNow.current = false;
      setBuilding('');
    }
  };

  const analyse = async () => {
    await askToAnalyse(via);
    refreshStatus();
    notify('Analysing the rest of your library in the background.');
  };

  const hero = cards?.find((card) => card.key === 'pick');
  const ready = cards?.filter((card) => card.ready && card.key !== 'pick') ?? [];
  const waiting = cards?.filter((card) => !card.ready && card.key !== 'christmas') ?? [];
  const visibleGroups = feelingGroup === 'All' ? GROUPS : GROUPS.filter((group) => group === feelingGroup);
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const readinessAvailable = Number.isFinite(counts.ready);
  const readyCount = counts.ready;
  // a mix that's playing or paused is what would be replaced, so that's when to ask (EX-0117-04: idle builds straight away)
  // ADR-0475 R8: with another device playing, a new mix replaces nothing there; that device is asked
  const replacing = mix.length > 0 && now.phase !== 'idle' && !(playOn && !playOn.now);
  // the current mix by name, quoted, so a name like "Your songs, in your browser" never reads as
  // part of the sentence around it
  const current = `your current mix, “${mixName}”`;
  const lengthScope = scopedSettings(on).find((setting) => setting.id === 'length');
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
          This running SelectaDJ server hasn’t reported how many songs have the cues needed for mixes.
          {' '}{words().mixesRestartToRefresh} Audio analysis is complete for {counts.analysed};
          {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'}
        </p>
        <div className="row">
          <button onClick={() => setView('Workshop')}>See progress</button>
        </div>
      </main>
    );
  }

  if (readyCount < readyNeeded) return <Preparing status={status} onAnalyse={analyse} />;

  // Browser-first Cloud also knows from the account's saved mixes, so a new device is not a first run.
  const firstMix = !mix.length && !startedAMix && !hasStartedAMix();
  return (
    <main className="page mixes" id="main">
      {firstMix && analysisAvailable && <SetupSteps stage="listen" />}
      {studioLayout ? <h1 className="display small">Make a Mix</h1> : (
        <header className="page-header">
          <div className="page-header-text">
            <h1 className="display small">Make a Mix</h1>
            <p className="page-lead">Choose a length and press Play. SelectaDJ lines up your songs and blends each one into the next.</p>
          </div>
        </header>
      )}
      <LinkTabs label="Make a Mix" items={exploreTabs()} current={exploreTabs().some((tab) => tab.path === here) ? here : '/mixes'} />
      {mix.length > 0 && analysisAvailable && <CurrentMix mix={mix} mixName={mixName} now={now} player={player} setView={setView} />}
      {/* in a browser the page is short (one pick, no feelings), so Play leads and the guide follows it */}
      {on('mixes.intent_language') && !firstMix && analysisAvailable && <MixIntentGuide replacing={replacing} mixName={mixName} savesEveryMix={false} />}

      {!studioLayout && (
        <QuickMix
          hero={hero} pending={!cards && !cardsFailed} playable={readyCount} total={counts.music} songs={songs} onSongs={setSongs}
          building={building.startsWith('pick')} blocked={!!building && !building.startsWith('pick')}
          onPlay={() => hero && ask({ key: 'pick', name: hero.name, open: false })}
          shape={shaping ? { summary: buildSummary(status.steering), open: () => setCustomizing(true) } : undefined}
          replacing={replacing ? 'The mix that is playing stays in My Mixes.' : undefined}
          problem={problem ? <p className="warn" role="alert">{problem}</p> : undefined}
          playOn={playOn}
        />
      )}
      {!studioLayout && on('lucy') && <p className="quick-mix-more"><PageLink to="/mixes/lucy" className="button">Plan a mix with Lucy</PageLink></p>}
      {!analysisAvailable && mix.length > 0 && <CurrentMix mix={mix} mixName={mixName} now={now} player={player} setView={setView} analysisAvailable={false} />}
      {studioLayout && <div className="mix-paths" role="group" aria-label="Ways to make a mix">
      <section className="hero mix-quick" aria-labelledby="mix-quick-title">
        {/* MP-0282-07: on the first run the notice under Play already says the library is ready */}
        {!firstMix && <p className="eyebrow">Quick Play · Tap and play</p>}
        <h2 id="mix-quick-title" className="mix-path-label">Listen now, shape later</h2>
        <h3 className="display">{hero?.name ?? 'SelectaDJ’s pick'}</h3>
        {/* MP-0283-01: what the pick can draw on sits between its name and its description, on the same edge as Play */}
        {/* P0032: until the pick's facts arrive their line is held by a bar, so the rest of the card stays put */}
        {!cards && !cardsFailed && <p className="vibe-card-facts mix-quick-facts skeleton-facts" aria-hidden="true"><i /><i /></p>}
        {hero && hero.songs > 0 && (
          <p className="vibe-card-facts mix-quick-facts">
            <span>{hero.songs} matching songs</span>
            <span>About {length(hero.seconds)} of matching source songs</span>
          </p>
        )}
        <p className="lede">{hero?.blurb ?? (analysisAvailable ? 'The strongest run it can find through your whole library, with a word hand-off or two.' : 'SelectaDJ builds a mix from the songs ready in your library.')}</p>
        <div className="row wrap">
          <Action
            className="primary big"
            disabled={!hero?.ready || (!!building && !building.startsWith('pick'))}
            busy={building.startsWith('pick')}
            limit={0}
            working="Building…"
            title={replacing ? (analysisAvailable ? `Replaces ${current}; you can undo that` : `Replaces ${current}, which stays in My Mixes`) : undefined}
            run={() => hero && ask({ key: 'pick', name: hero.name, open: false })}
          >
            {playOn?.now && !playOn.ask ? `Play on ${playOn.name}` : 'Play'}
          </Action>
          <div className="chips" role="group" aria-label="How long, roughly">
            {SET_LENGTHS.map((option) => (
              <button key={option.songs} aria-pressed={songs === option.songs} onClick={() => setSongs(option.songs)}>
                About {option.label}
              </button>
            ))}
          </div>
          {shaping && <button aria-label="Customize: Shape this mix (optional)" onClick={() => setCustomizing(true)}>Shape this mix <span className="soft">(optional)</span></button>}
        </div>
        {/* the length chips' scope, said beside its own words rather than as a loose badge in the chips */}
        {on('mixes.intent_language') && lengthScope && <p className="hint mix-length-scope"><ScopeTag scope={lengthScope.scope} /> How long: {lengthScope.detail}</p>}
        {/* MP-0282-07: the first-run reassurance sits under Play, so Play stays in the first screen on a phone */}
        {firstMix && (
          <p className="notice" role="status">
            Your library now has enough ready songs to make a first mix. Nothing starts playing until you choose Play.
          </p>
        )}
        {hero && !hero.ready && <p className="hint">{hero.name} needs {hero.needs} more mix-ready {hero.needs === 1 ? 'song' : 'songs'} before it can play.</p>}
        {shaping && <p className="hint build-summary"><b>Shape</b> · Next mix: {buildSummary(status.steering)}.</p>}
        <p className="hint">
          <b>Commit</b> · {listed(['Play now', on('editor') && 'edit first', on('drafts') && 'save a draft']).replace(' and ', ', or ')}. {songs} songs. How long it really runs depends on where the transitions fall.
          {replacing ? ` Playing a new mix replaces ${current}${analysisAvailable ? '; you can undo that' : ', which stays in My Mixes'}.${on('drafts') ? ' To keep it playing, use Save as draft.' : ''}` : ''}
        </p>
      </section>
      {on('mixes.intent_language') && firstMix && <MixIntentGuide replacing={replacing} mixName={mixName} savesEveryMix={!analysisAvailable} />}

      {on('lucy') && (
      <section className="mix-create" aria-labelledby="mix-create-title">
        <p className="eyebrow">Create · Plan before listening</p>
        <h2 id="mix-create-title">Create with Lucy</h2>
        <p>Describe the mood, songs or journey you have in mind. Lucy proposes an exact order and transitions for you to review.</p>
        <PageLink to="/mixes/lucy" className="button">Plan a mix with Lucy</PageLink>
        <p className="hint">Optional. Nothing is sent, saved or played until you choose to do it. Quick Play does not use Lucy.</p>
      </section>
      )}
      </div>}

      {problem && studioLayout && <p className="warn" role="alert">{problem}</p>}
      {on('mixes.intent_language') && !firstMix && !analysisAvailable && <MixIntentGuide replacing={replacing} mixName={mixName} savesEveryMix />}

      {/* Loaded and empty reflows away: a header with no feelings under it promises nothing
          (the waiting and nudge sections below say what would unlock ideas). */}
      {on('mixes.ideas') && (!cards || cardsFailed || ready.length > 0) && (
      <section>
        <div className="vibe-browser-head">
          <div>
            <p className="eyebrow">More ways into your library</p>
            <h2 className="section-title">Choose another feeling</h2>
            <p className="hint">
              {ready.length
                ? `${ready.length} available ideas. These are planning preferences, not previews; SelectaDJ builds a new actual mix after you choose.`
                : !cards && !cardsFailed
                  // P0032: while the ideas load, the same words in the same space, without a count it doesn't have yet
                  ? 'Finding the ideas your songs support. These are planning preferences, not previews; SelectaDJ builds a new actual mix after you choose.'
                  : 'Every mix is rebuilt from your own songs when you press play.'}
            </p>
          </div>
          {/* P0032: the filter names are known before the ideas arrive, so they hold the filters' place,
              unpressable and without counts, until there is something to filter */}
          {!cards && !cardsFailed && (
            <div className="chips vibe-filters vibe-filters-pending" aria-hidden="true">
              {['All', ...GROUPS].map((group) => (
                <button key={group} type="button" disabled tabIndex={-1}>
                  {group}<span aria-hidden="true" style={{ visibility: 'hidden' }}> · {group === 'All' ? '00' : '0'}</span>
                </button>
              ))}
            </div>
          )}
          {!!ready.length && (
            <div className="chips vibe-filters" role="group" aria-label="Filter mix feelings">
              {['All', ...GROUPS].map((group) => {
                const count = group === 'All' ? ready.length : ready.filter((card) => card.group === group).length;
                if (group !== 'All' && count === 0) return null;
                return (
                  <button key={group} aria-pressed={feelingGroup === group} onClick={() => setFeelingGroup(group)}>
                    {group}<span aria-hidden="true"> · {count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {cardsFailed && <Problem retry={() => setCardsAttempt((value) => value + 1)}>Couldn’t load mix suggestions. Try again when SelectaDJ is available.</Problem>}
        {!cards && !cardsFailed && <Skeleton variant="vibes" lines={6} label="Finding compatible mix candidates" retry={() => setCardsAttempt((value) => value + 1)} />}
        {visibleGroups.map((group) => {
          const inGroup = ready.filter((card) => card.group === group);
          if (!inGroup.length) return null;
          return (
            <div className="vibe-group" key={group}>
              <h3 className="eyebrow">{group}</h3>
              <div className="cards">
                {inGroup.map((card) => (
                  <article className="card vibe-card" key={card.key} data-vibe={card.key} data-lift="" data-glow="">
                    <VibeMotif idea={card.key} group={card.group} />
                    <div className="vibe-card-head">
                      <h3>{card.name}</h3>
                      {card.tempo && <span className="vibe-tempo">{card.tempo[0]}–{card.tempo[1]} BPM</span>}
                    </div>
                    {card.family && <p className="vibe-scope"><Icon name="circle" size="compact" /> Stays within {card.family}</p>}
                    <p className="vibe-card-summary">{card.blurb}</p>
                    <div className="vibe-card-facts" aria-label={`${card.songs} matching songs, about ${length(card.seconds)} of matching source audio`}>
                      <span>{card.songs} matching songs</span>
                      <span>About {length(card.seconds)} of matching source songs</span>
                    </div>
                    <details className="vibe-card-detail">
                      <summary>Why {card.name}? More details</summary>
                      <p>{card.blurb}</p>
                      <p className="artists"><span>Draws from</span> {card.artists.join(', ') || 'your mix-ready songs'}</p>
                      <p className="how">{card.moves}</p>
                      {!!card.basis?.length && <p className="vibe-basis">Chosen by {listed(card.basis)}, measured from your songs. The name and words describe the aim, not a label on every song.</p>}
                      <p className="hint">Planning preference, not a promised song order or transition quality. Play replaces the current mix after confirmation{on('editor') ? '; Shape first opens the new mix for editing' : ''}{on('drafts') ? '; Save draft leaves playback unchanged' : ''}. The generated result depends on available recordings and cues.</p>
                      {on('lucy') && (
                        <>
                          <PageLink className="button quiet" to={`/mixes/lucy?prompt=${encodeURIComponent(`I'd like a mix with the ${card.name} feeling. ${card.blurb}`)}`}>Use this feeling with Lucy</PageLink>
                          <p className="hint">This opens an editable suggestion in Lucy; it does not send a request.</p>
                        </>
                      )}
                    </details>
                    {/* MP-0274-04: the actions close the card, so Play and Shape first share one line across a row of
                        cards however a name, summary or this disclosure wraps */}
                    <div className="row card-actions" data-count={on('editor') ? 2 : 1}>
                      <Action className="primary" limit={0} disabled={!!building && building !== card.key} busy={building === card.key} working="Building…" run={() => ask({ key: card.key, name: card.name, open: false })}>{playOn?.now && !playOn.ask ? `Play on ${playOn.name}` : 'Play'}</Action>
                      {on('editor') && <Action className="quiet" limit={0} disabled={!!building && building !== `${card.key}:open`} busy={building === `${card.key}:open`} working="Building…" run={() => ask({ key: card.key, name: card.name, open: true })}>Shape first</Action>}
                      {on('drafts') && <Action className="quiet save-draft" limit={0} disabled={!!building && building !== `${card.key}:draft`} busy={building === `${card.key}:draft`} working="Saving…" run={() => keepAsDraft(card.key)}>Save draft{" "}<span className="visually-hidden">for {card.name}</span></Action>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>
      )}

      {on('mixes.ideas') && waiting.length > 0 && (
        <section className="waiting">
          <h2 className="section-title">Needs more mix-ready songs</h2>
          <p className="hint">These ideas do not have enough eligible recordings yet. You can try another available idea, or analyse more songs. No new mix will be made from an unavailable idea.</p>
          <ul>
            {waiting.map((card) => (
              <li key={card.key}>
                <b>{card.name}</b> <span className="soft">needs {card.needs} more</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {left > 0 && analysisAvailable && (
        <section className="nudge">
          <p>
            <b>{counts.analysed} of {counts.music} songs have audio analysis; {counts.ready ?? 0} are ready for mixes.</b> The rest will mean more variety{on('discover.word_links') ? ' and word links' : ''}. {analysisWords(status.eta?.analysis)}
          </p>
          {status.analysis_running ? (
            <button onClick={() => setView('Workshop')}>Analysing now, see progress</button>
          ) : (
            <Action run={analyse}>Analyse the rest</Action>
          )}
        </section>
      )}

      {customizing && shaping && <MixSetup status={status} mix={mix} refreshStatus={refreshStatus} notify={notify} songs={songs} onSongs={setSongs} onClose={() => setCustomizing(false)} />}
      {confirming && (
        <Dialog
          title={`Replace ${mixName}?`}
          onClose={() => setConfirming(null)}
          footer={(
            <>
              <button onClick={() => setConfirming(null)}>Cancel</button>
              {on('drafts') && <Action limit={0} working="Saving…" run={async () => { const { key } = confirming; setConfirming(null); await keepAsDraft(key); }}>Save as draft instead</Action>}
              <Action limit={0} className="primary" working="Building…" run={async () => { const asked = confirming; setConfirming(null); await start(asked); }}>
                {confirming.open ? 'Replace and edit' : 'Replace and play'}
              </Action>
            </>
          )}
        >
          <p>
            <b>{confirming.name}</b> would take over from <b>{mixName}</b>, which is {now.phase === 'paused' ? 'paused' : 'playing'}. You can undo this straight afterwards.
          </p>
          {on('drafts') && <p className="hint">Saving it as a draft instead leaves what’s playing exactly as it is.</p>}
        </Dialog>
      )}
    </main>
  );
}
