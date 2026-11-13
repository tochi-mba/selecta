import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { get, MixData, MixItem } from '../api';
import { useFlags } from '../flags';
import { getDraftNames } from '../state/draftNames';
import { occurrenceKeys, orderOf } from '../state/readiness';
import { CurrentMix, NoCurrentMix } from './CurrentMix';
import { Drafts } from './Drafts';
import { selectInEditor } from './Mix';
import { ViewProps } from './shared';

const RECENT_DRAFT_KEY = 'selecta.recentDraft';
// r8a: My Mixes redraws with the music clock (the current mix says Playing or Paused), and its list of
// drafts mustn't redraw with it. Memoised, and handed functions that never change.
const StableDrafts = memo(Drafts);
/** GP-0255-01: what can be returned to, and where its authority lives. The draft is known by its ID and
 * exact song order, the only things this browser keeps. Each song by its occurrence in that order, and
 * each transition by the two occurrences it joins, are worked out fresh from the server's copy, never
 * stored, so a return can't reach a song or transition that has since moved or gone. */
type WaitingTransition = { a: string; b: string; from: string; into: string; why: string };
type RecentDraft = { id: number; name: string; order: string; waiting: WaitingTransition[] };

/** The transitions in a draft that still need someone, from the server's own state. */
export function transitionsWaiting(mix: MixItem[]): WaitingTransition[] {
  const keys = occurrenceKeys(mix);
  return mix.flatMap((item, index) => {
    if (index === 0) return [];
    const state = item.seam?.state;
    const why = item.seam?.too_soon
      ? 'its timing needs fixing'
      : state?.status === 'failed'
        ? 'it couldn’t be made'
        : !state || state.status === 'none'
          ? 'it hasn’t been rendered yet'
          : null;
    return why ? [{ a: keys[index - 1], b: keys[index], from: mix[index - 1].title, into: item.title, why }] : [];
  });
}

/** An optional return shortcut. Trust the server's exact order, never a stored title,
 * selected transition, or optimistic snapshot from a previous browser session. */
export function MyMixes({ mix, mixName, now, player, setView, notify, openDraft, playDraft }: ViewProps) {
  const [recent, setRecent] = useState<RecentDraft | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let active = true;
    let saved: { id: number; order: string } | null = null;
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(RECENT_DRAFT_KEY) ?? 'null');
      if (value && typeof value === 'object') {
        const candidate = value as { id?: unknown; order?: unknown };
        if (typeof candidate.id === 'number' && Number.isSafeInteger(candidate.id) && candidate.id > 0 && typeof candidate.order === 'string') {
          saved = { id: candidate.id as number, order: candidate.order };
        }
      }
    } catch { /* disabled storage or obsolete format */ }
    if (saved === null) return;
    const target = saved;
    // only the names are needed here; Drafts below reads the whole list for itself
    void Promise.all([getDraftNames(), get<MixData>(`/mix?draft=${target.id}`)])
      .then(([list, detail]) => {
        if (!active) return;
        const draft = list.drafts.find((item) => item.id === target.id);
        if (draft && orderOf(detail.mix) === target.order) {
          setRecent({ id: draft.id, name: draft.name, order: target.order, waiting: transitionsWaiting(detail.mix) });
        } else {
          window.localStorage.removeItem(RECENT_DRAFT_KEY);
        }
      }).catch(() => { /* no shortcut while offline; normal drafts remain available */ });
    return () => { active = false; };
  }, []);

  const continueEditing = async (transition?: WaitingTransition) => {
    if (!recent || checking) return;
    setChecking(true);
    setProblem('');
    try {
      const current = await get<MixData>(`/mix?draft=${recent.id}`);
      if (orderOf(current.mix) !== recent.order) {
        setRecent(null);
        try { window.localStorage.removeItem(RECENT_DRAFT_KEY); } catch { /* storage disabled */ }
        setProblem('This draft changed since your last visit. Open it from the draft list to review the latest version.');
        return;
      }
      if (transition) {
        selectInEditor(player, `draft:${recent.id}`, { kind: 'seam', a: transition.a, b: transition.b, from: transition.from, into: transition.into });
      }
      openDraft?.(recent.id);
    } catch {
      setProblem('Could not verify that draft. Open it from the draft list when the server is available.');
    } finally { setChecking(false); }
  };

  const forget = () => {
    setRecent(null);
    setProblem('');
    try { window.localStorage.removeItem(RECENT_DRAFT_KEY); } catch { /* storage disabled */ }
  };

  const latest = useRef({ notify, openDraft, playDraft, setView });
  latest.current = { notify, openDraft, playDraft, setView };
  const stableNotify = useCallback<ViewProps['notify']>((...args) => latest.current.notify(...args), []);
  const stableOpen = useCallback((id: number) => latest.current.openDraft?.(id), []);
  const stablePlay = useCallback((id: number) => latest.current.playDraft?.(id) ?? Promise.resolve(), []);
  const stableSetView = useCallback<ViewProps['setView']>((...args) => latest.current.setView(...args), []);

  const on = useFlags();
  // SF-0204-02: one primary action. Continue editing leads when offered, then the drafts (first Edit or
  // Start your first draft), and the current mix only when drafts are off.
  const continuing = !!recent && on('mymixes.continue_working') && on('editor');
  return (
    <main className="page mixes my-mixes" id="main">
      <h1 className="display small">My Mixes</h1>
      {recent && continuing && <section className="panel stack" aria-label="Continue working">
        <h2>Continue working</h2>
        <p>Return to <b>{recent.name}</b> at its last saved song order. This only opens the editor - no playback starts and no pending Studio edits are applied.</p>
        <div className="row wrap">
          <button className="primary" disabled={checking} onClick={() => void continueEditing()}>
            {checking ? 'Checking draft…' : 'Continue editing draft'}
          </button>
          <button onClick={forget}>Forget shortcut</button>
        </div>
        {!!recent.waiting.length && (
          <div className="stack">
            <h3>Transitions waiting on you</h3>
            <ul className="continue-transitions">
              {recent.waiting.slice(0, 3).map((transition) => (
                <li key={`${transition.a}>${transition.b}`}>
                  <span>{transition.from} into {transition.into}: {transition.why}.</span>{' '}
                  <button disabled={checking} onClick={() => void continueEditing(transition)}
                    aria-label={`Open the transition from ${transition.from} into ${transition.into}`}>
                    Open this transition
                  </button>
                </li>
              ))}
            </ul>
            {recent.waiting.length > 3 && <p className="hint">and {recent.waiting.length - 3} more in the draft.</p>}
          </div>
        )}
      </section>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {mix.length > 0
        ? <CurrentMix prominent lead={!continuing && !on('drafts')} mix={mix} mixName={mixName} now={now} player={player} setView={setView} />
        : <NoCurrentMix lead={!continuing && !on('drafts')} />}
      {on('drafts') && <StableDrafts lead={!continuing} notify={stableNotify} openDraft={stableOpen} playDraft={stablePlay} setView={stableSetView} />}
    </main>
  );
}
