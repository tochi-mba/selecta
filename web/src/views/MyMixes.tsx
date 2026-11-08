import { useEffect, useState } from 'react';
import { DraftList, get, MixData } from '../api';
import { orderOf } from '../state/readiness';
import { CurrentMix, NoCurrentMix } from './CurrentMix';
import { Drafts } from './Drafts';
import { ViewProps } from './shared';

const RECENT_DRAFT_KEY = 'selecta.recentDraft';
type RecentDraft = { id: number; name: string; order: string };

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
    void Promise.all([get<DraftList>('/drafts'), get<MixData>(`/mix?draft=${target.id}`)])
      .then(([list, detail]) => {
        if (!active) return;
        const draft = list.drafts.find((item) => item.id === target.id);
        if (draft && orderOf(detail.mix) === target.order) {
          setRecent({ id: draft.id, name: draft.name, order: target.order });
        } else {
          window.localStorage.removeItem(RECENT_DRAFT_KEY);
        }
      }).catch(() => { /* no shortcut while offline; normal drafts remain available */ });
    return () => { active = false; };
  }, []);

  const continueEditing = async () => {
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

  return (
    <main className="page mixes my-mixes" id="main">
      <h1 className="display small">My Mixes</h1>
      {recent && <section className="panel stack" aria-label="Continue working">
        <h2>Continue working</h2>
        <p>Return to <b>{recent.name}</b> at its last saved song order. This only opens the editor - no playback starts and no pending Studio edits are applied.</p>
        <div className="row wrap">
          <button className="primary" disabled={checking} onClick={() => void continueEditing()}>
            {checking ? 'Checking draft…' : 'Continue editing draft'}
          </button>
          <button onClick={forget}>Forget shortcut</button>
        </div>
      </section>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {mix.length > 0
        ? <CurrentMix prominent mix={mix} mixName={mixName} now={now} player={player} setView={setView} />
        : <NoCurrentMix />}
      <Drafts notify={notify} openDraft={openDraft} playDraft={playDraft} setView={setView} />
    </main>
  );
}
