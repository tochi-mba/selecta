import { ReactNode, useEffect, useId, useState } from 'react';
import { ApiError } from '../api';
import { length } from '../lib';
import { lucy } from '../lucy/client';
import type { ProposalState } from '../lucy/reducer';
import type { Diff, EditOp, Phases, ProposalSnapshot, Revision, Rule, Selection } from '../lucy/types';
import { countsWords, EXAMPLE_PROMPTS, isReadyStatus, plural, whenWords } from '../lucy/words';
import { Action, Menu, Skeleton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { EnergyBars, SongsAndSeams } from './LucySongs';

/** The mix Lucy is proposing. It's only ever a proposal here: nothing is built, saved or played until
 * it's approved. Older revisions can be looked at and compared, but only the current one can be
 * changed or approved. A new revision arriving updates this in place without moving focus. */

export type Lifecycle = 'proposed' | 'approved' | 'draft' | 'rendering' | 'ready' | 'playing';

const LIFECYCLE_WORDS: Record<Lifecycle, string> = {
  proposed: 'Proposed — not built',
  approved: 'Approved',
  draft: 'Saved draft',
  rendering: 'Rendering',
  ready: 'Ready to play',
  playing: 'Playing',
};

export function LifecyclePill({ stage }: { stage: Lifecycle }) {
  return <span className={`lucy-stage is-${stage}`}>{LIFECYCLE_WORDS[stage]}</span>;
}

export function ExamplePrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="lucy-examples" role="group" aria-label="Example requests">
      {EXAMPLE_PROMPTS.map((prompt) => (
        <button key={prompt} type="button" onClick={() => onPick(prompt)}>{prompt}</button>
      ))}
    </div>
  );
}

function durationText(snapshot: ProposalSnapshot): string {
  const duration = snapshot.evaluation?.duration;
  if (!duration || !Number.isFinite(duration.low) || !Number.isFinite(duration.high) || duration.high <= 0) return 'Length unknown';
  if (duration.exact) return `Runs ${length(duration.low)}`;
  return length(duration.low) === length(duration.high) ? `About ${length(duration.low)}` : `About ${length(duration.low)}–${length(duration.high)}`;
}

export function DiffSummary({ diff, label }: { diff: Diff; label: string }) {
  const removed = diff.removed?.filter((song) => song.title) ?? [];
  return (
    <div className="lucy-diff">
      <p><b>{label}</b> {countsWords(diff.counts)}.</p>
      {removed.length > 0 && <p className="hint">Taken out: {removed.map((song) => song.title).join(', ')}.</p>}
      {!!diff.rules_changed?.length && <p className="hint">{plural(diff.rules_changed.length, 'rule')} changed.</p>}
    </div>
  );
}

function Rules({ rules, readyOnly, editable, onRemove }: { rules: Rule[]; readyOnly: boolean; editable: boolean; onRemove: (rule: Rule) => Promise<void> }) {
  const active = rules.filter((rule) => rule.status === 'active');
  const readyRule = active.find((rule) => /ready/i.test(rule.kind));
  const others = active.filter((rule) => rule !== readyRule);
  if (!readyOnly && !readyRule && !others.length) return null;
  const remove = (rule: Rule, name: string) => editable && (
    <Action className="lucy-rule-remove" working={<span aria-hidden="true">…</span>} aria-label={`Remove rule: ${name}`} run={() => onRemove(rule)}>
      <Icon name="close" width={14} height={14} />
    </Action>
  );
  return (
    <ul className="lucy-rules" aria-label="Rules for this mix">
      {(readyOnly || readyRule) && (
        <li className="lucy-rule lucy-ready-only">
          <Icon name="check" width={16} height={16} />
          <span><span className="lucy-strength">Must</span> Only transitions that are already ready</span>
          {readyRule && remove(readyRule, 'only transitions that are already ready')}
        </li>
      )}
      {others.map((rule) => (
        <li key={rule.id} className={`lucy-rule is-${rule.strength}`}>
          <span><span className="lucy-strength">{rule.strength === 'hard' ? 'Must' : 'Prefer'}</span> <span dir="auto">{rule.label || rule.text}</span></span>
          {remove(rule, rule.label || rule.text)}
        </li>
      ))}
    </ul>
  );
}

export function ProposalPane({ proposal, revision, phases, selection, onAsk, adopt, reload, fillComposer, approve }: {
  proposal: ProposalState | null;
  revision: Revision | null;
  phases: Phases | null;
  selection: Selection | null;
  onAsk: (selection: Selection, label: string) => void;
  adopt: (revision: Revision) => void;
  reload: () => void;
  fillComposer: (text: string) => void;
  approve: (shown: Revision, isCurrent: boolean) => ReactNode;
}) {
  const headingId = useId();
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Revision | null>(null);
  const [compared, setCompared] = useState<Diff | null>(null);
  const [problem, setProblem] = useState('');
  const currentId = proposal?.currentId ?? null;

  useEffect(() => {
    setCompared(null);
    if (!viewing || viewing === currentId) {
      setViewing(null);
      setViewed(null);
      return;
    }
    let live = true;
    setViewed(null);
    lucy.revision(viewing).then((found) => { if (live) setViewed(found); }).catch((error: Error) => { if (live) setProblem(`Couldn’t open that revision: ${error.message}`); });
    return () => { live = false; };
  }, [viewing, currentId]);

  if (phases && !phases.proposals) {
    return (
      <section className="lucy-proposal is-empty" aria-labelledby={headingId}>
        <p className="eyebrow">Your mix</p>
        <h2 id={headingId}>Proposals are turned off</h2>
        <p className="hint">Lucy can still talk about mixes, but won’t plan one here. Turn proposals back on in Lucy’s settings.</p>
      </section>
    );
  }
  if (!proposal || (!currentId && !proposal.history.length)) {
    return (
      <section className="lucy-proposal is-empty" aria-labelledby={headingId}>
        <p className="eyebrow">Your mix</p>
        <h2 id={headingId}>Nothing proposed yet</h2>
        <p className="hint">Describe the mix you want in the chat. Lucy plans it here, and nothing is built until you approve it. Try one of these:</p>
        <ExamplePrompts onPick={fillComposer} />
      </section>
    );
  }

  const shown = viewing ? viewed : revision;
  if (!shown) return <section className="lucy-proposal" aria-busy="true" aria-labelledby={headingId}><h2 id={headingId} className="visually-hidden">Your mix</h2><Skeleton variant="timeline" label="Opening the proposed mix" /></section>;

  const isCurrent = shown.id === currentId;
  const snap = shown.snapshot;
  const songs = snap.songs ?? [];
  const needed = Math.max(0, songs.length - 1);
  const ledger = shown.ledger;
  // Count verified audio for each current *directed neighbouring pair*, not
  // unrelated ledger rows or a stale aggregate from a previous order.
  const readyPairs = new Set((ledger ? ledger.seams
    .filter((seam) => seam.verified && isReadyStatus(seam.status))
    : (snap.seams ?? []).filter((seam) => seam.ready.verified && isReadyStatus(seam.ready.status)))
    .map((seam) => JSON.stringify([seam.a_occ, seam.b_occ])));
  const ready = songs.slice(1).filter((song, index) =>
    readyPairs.has(JSON.stringify([songs[index].occurrence, song.occurrence]))).length;
  const currentNumber = proposal.history.find((item) => item.id === currentId)?.number ?? revision?.number;
  const warnings = [...new Set(snap.evaluation?.warnings ?? [])];

  const change = async (call: () => Promise<Revision>): Promise<boolean> => {
    setProblem('');
    try {
      const next = await call();
      setViewing(null);
      adopt(next);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setProblem(error.code === 'stale_revision'
          ? 'The mix changed in the meantime, so nothing was changed. You’re now looking at the newest version.'
          : error.message);
        reload();
        return false;
      }
      throw error;
    }
  };
  const edit = (op: EditOp) => change(() => lucy.edit(shown.id, shown.id, op)).catch((error: Error) => { setProblem(error.message); return false; });

  return (
    <section className="lucy-proposal" aria-labelledby={headingId}>
      <header className="lucy-proposal-head">
        <p className="eyebrow">Your mix</p>
        <h2 id={headingId} dir="auto">{snap.title || 'Untitled mix'}</h2>
        <div className="row wrap">
          <LifecyclePill stage="proposed" />
          <Menu className="lucy-revisions" label={<>Revision {shown.number}{isCurrent ? '' : ' (not the current one)'} <Icon name="down" width={14} height={14} /></>}>
            {[...proposal.history].reverse().map((item) => (
              <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === shown.id} onClick={() => setViewing(item.id === currentId ? null : item.id)}>
                Revision {item.number}{item.current ? ' · current' : ''}{item.summary ? ` — ${item.summary}` : ''}
              </button>
            ))}
          </Menu>
        </div>
      </header>

      {!isCurrent && (
        <div className="lucy-viewing" role="group" aria-label="An older revision">
          <p><b>You’re looking at revision {shown.number}.</b> {currentNumber ? `The current one is revision ${currentNumber}. ` : ''}Only the current revision can be changed or approved.</p>
          <div className="row wrap">
            {currentId && <Action working="Comparing…" run={async () => setCompared(await lucy.diff(shown.id, currentId))}>Compare with current</Action>}
            <Action working="Switching…" run={() => change(() => lucy.makeCurrent(proposal.id, shown.id, currentId))}>Make this the current one</Action>
            <Action working="Restoring…" run={() => change(() => lucy.restore(shown.id, currentId))}>Restore as new revision</Action>
            <button type="button" className="quiet" onClick={() => setViewing(null)}>Back to the current one</button>
          </div>
          {compared && <DiffSummary diff={compared} label={`Compared with revision ${currentNumber ?? 'current'}:`} />}
        </div>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}

      <Rules rules={snap.constraints ?? []} readyOnly={snap.ready_only} editable={isCurrent} onRemove={async (rule) => { await change(() => lucy.removeRule(shown.id, rule.id, shown.id)); }} />

      <p className="lucy-summary">
        <b>{plural(songs.length, 'song')}</b> · {ready} of {plural(needed, 'transition')} ready · {durationText(snap)}
      </p>
      {ledger && <p className="hint">Readiness checked {whenWords(ledger.checked_at) || 'recently'}{ledger.playable_now && ready === needed ? '. Every directed transition has verified playable audio.' : '. Readiness is not guaranteed until checked again at approval.'}</p>}
      {snap.ready_only && ready < needed && <p className="lucy-readiness-warning" role="status">Only {ready} of {needed} required directed transitions have verified audio. This strict plan cannot be saved as ready-only yet. Ask Lucy for a shorter ready route, or explicitly change the rule before approving.</p>}

      {approve(shown, isCurrent)}

      {songs.length > 1 && <EnergyBars values={songs.map((song) => song.energy)} />}
      {warnings.length > 0 && (
        <div className="lucy-warnings-box">
          <h3>Worth knowing</h3>
          <ul className="lucy-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
      {snap.diff && isCurrent && <DiffSummary diff={snap.diff} label="Latest change:" />}

      <SongsAndSeams snapshot={snap} ledger={ledger} editable={isCurrent} selection={selection} onEdit={edit} onAsk={onAsk} />
    </section>
  );
}
