import { useEffect, useRef, useState } from 'react';
import { ApiError, problemKind } from '../api';
import { lucy, newId } from '../lucy/client';
import type { CommitNote } from '../lucy/reducer';
import type { Approval, ApproveAction, Commit, Revision } from '../lucy/types';
import { PageLink } from '../shell/PageLink';
import { Action } from '../ui/controls';
import { NativeDialog } from './LucyDialog';
import { LifecyclePill } from './LucyProposal';

/** Turning a proposal into something real. Saving and saving-then-playing are separate buttons, each
 * checked by the server first and confirmed in a dialog that says exactly what will be saved. The
 * confirmation is sent once, under a name kept until it's answered, so a lost reply is looked up
 * rather than sent again. Nothing here navigates anywhere by itself. */

const PENDING_KEY = 'selecta.lucy.commit';
const POLL_MS = 1500;
const POLL_LIMIT = 40;

type PendingCommit = { key: string; token: string; action: ApproveAction; revision: string };

type Outcome =
  | { state: 'saving' }
  | { state: 'checking' }
  | { state: 'saved'; commit: Commit; action: ApproveAction; startedHere: boolean }
  | { state: 'failed'; message: string; problems: string[] }
  | { state: 'not-received' }
  | { state: 'unknown'; message: string };

function readPending(): PendingCommit | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) ?? 'null') as PendingCommit | null;
    return saved && typeof saved.key === 'string' && typeof saved.token === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function writePending(pending: PendingCommit | null) {
  try {
    if (pending) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* it's still held in memory for as long as this page is open */
  }
}

const expired = (approval: Approval) => {
  const at = approval.expires_at > 1e12 ? approval.expires_at : approval.expires_at * 1000;
  return Number.isFinite(at) && at > 0 && Date.now() > at;
};

export function Approve({ revision, isCurrent, blocked, seen, onStale, startPlaying }: {
  revision: Revision;
  isCurrent: boolean;
  /** Why saving isn't possible at all right now, such as saving being turned off. */
  blocked: string;
  /** What the live event log has said about commits. */
  seen: Record<string, CommitNote>;
  onStale: () => void;
  /** Start the app's player on the newly current mix, after a confirmed Save and play. */
  startPlaying: () => Promise<void>;
}) {
  const [approval, setApproval] = useState<Approval | null>(null);
  // A preflight token applies to one immutable revision. Keep it tied to that
  // revision even between a prop change and the effect that clears the dialog.
  const revisionNow = useRef(revision.id);
  revisionNow.current = revision.id;
  const [approvalFor, setApprovalFor] = useState('');
  const approvalRequest = useRef(0);
  const activeApproval = approvalFor === revision.id ? approval : null;
  const [understood, setUnderstood] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lapsed, setLapsed] = useState(false);
  // An approval token describes one exact immutable proposal revision.
  useEffect(() => {
    approvalRequest.current += 1;
    setApproval(null);
    setApprovalFor('');
    setUnderstood(false);
    setOutcome(null);
    setLapsed(false);
  }, [revision.id]);
  const pending = useRef<PendingCommit | null>(readPending());
  const confirmedHere = useRef(new Set<string>());
  // the live log and the reply itself can both report the same commit; it's only settled once
  const settled = useRef(new Set<string>());
  const poll = useRef<{ timer?: number; count: number }>({ count: 0 });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(poll.current.timer);
    };
  }, []);

  const finish = (key: string) => {
    if (pending.current?.key === key) {
      pending.current = null;
      writePending(null);
    }
  };

  const settle = async (asked: PendingCommit, commit: Commit) => {
    if (!alive.current) return;
    // A reply from a prior revision must neither present a saved result as
    // belonging to this revision nor start music after the person moved on.
    if (asked.revision !== revisionNow.current) {
      confirmedHere.current.delete(asked.key);
      if (commit.status !== 'pending') finish(asked.key);
      return;
    }
    if (commit.status === 'pending') {
      setOutcome({ state: 'saving' });
      if (poll.current.count++ < POLL_LIMIT) {
        window.clearTimeout(poll.current.timer);
        poll.current.timer = window.setTimeout(() => void reconcile(asked), POLL_MS);
      } else {
        setOutcome({ state: 'unknown', message: 'Selecta is still working on it.' });
      }
      return;
    }
    poll.current.count = 0;
    finish(asked.key);
    if (settled.current.has(asked.key)) return;
    settled.current.add(asked.key);
    if (commit.status === 'failed') {
      setOutcome({ state: 'failed', message: 'Nothing was saved.', problems: commit.problems ?? [] });
      return;
    }
    // Only a Save and play confirmed on this page, just now, starts the music. Coming back to a
    // commit made earlier never does.
    const startedHere = commit.played && asked.action === 'draft_and_play' && confirmedHere.current.has(asked.key);
    setOutcome({ state: 'saved', commit, action: asked.action, startedHere });
    if (startedHere) {
      confirmedHere.current.delete(asked.key);
      await startPlaying().catch(() => {});
    }
  };

  async function reconcile(asked: PendingCommit) {
    if (!alive.current) return;
    if (asked.revision === revisionNow.current) {
      setOutcome((was) => (was?.state === 'saving' ? was : { state: 'checking' }));
    }
    try {
      await settle(asked, await lucy.commitResult(asked.key));
    } catch (error) {
      if (!alive.current || asked.revision !== revisionNow.current) return;
      if (error instanceof ApiError && error.status === 404) setOutcome({ state: 'not-received' });
      else setOutcome({ state: 'unknown', message: problemKind(error) === 'offline' ? 'Selecta can’t be reached right now.' : (error as Error).message });
    }
  }

  const submit = async (asked: PendingCommit) => {
    setOutcome({ state: 'saving' });
    try {
      const commit = await lucy.commit({ token: asked.token, idempotency_key: asked.key, confirm_play: asked.action === 'draft_and_play' ? true : undefined });
      await settle(asked, commit);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        finish(asked.key);
        if (error.code === 'stale_revision') onStale();
        setOutcome({ state: 'failed', message: error.message, problems: [] });
        return;
      }
      // the answer was lost on the way back, so find out what happened instead of sending it again
      await reconcile(asked);
    }
  };

  // A confirmation from an earlier visit that never got its answer is looked up, not repeated.
  useEffect(() => {
    if (pending.current) void reconcile(pending.current);
  }, []);

  useEffect(() => {
    const asked = pending.current;
    if (!asked || !seen[asked.key]) return;
    if (seen[asked.key].status !== 'pending') void reconcile(asked);
  }, [seen]);

  const ask = async (action: ApproveAction) => {
    if (pending.current) return;
    const requestedRevision = revision.id;
    const mine = ++approvalRequest.current;
    setOutcome(null);
    setLapsed(false);
    try {
      const answer = await lucy.approve({ revision: requestedRevision, hash: revision.hash, action });
      if (revisionNow.current !== requestedRevision || approvalRequest.current !== mine) return;
      setUnderstood(false);
      setApprovalFor(requestedRevision);
      setApproval(answer);
    } catch (error) {
      if (revisionNow.current !== requestedRevision || approvalRequest.current !== mine) return;
      if (error instanceof ApiError && error.status === 409) onStale();
      throw error;
    }
  };

  const confirm = async () => {
    const chosen = activeApproval;
    if (!chosen) return;
    if (expired(chosen)) {
      setLapsed(true);
      return;
    }
    const asked = pending.current?.token === chosen.token
      ? pending.current
      : { key: newId(), token: chosen.token, action: chosen.action, revision: revision.id };
    pending.current = asked;
    writePending(asked);
    confirmedHere.current.add(asked.key);
    setApproval(null);
    await submit(asked);
  };

  const busy = outcome?.state === 'saving' || outcome?.state === 'checking';
  const disabled = !isCurrent || !!blocked || busy || !!pending.current || outcome?.state === 'saved';
  const preflight = activeApproval?.preflight;
  const problems = preflight?.problems ?? [];
  const playing = activeApproval?.action === 'draft_and_play';
  const missingStrictEdges = !!preflight?.ready_only && preflight.ready < preflight.needed;
  const canConfirm = !!preflight && !disabled && preflight.ok !== false
    && !problems.length && !missingStrictEdges && (!playing || understood) && !lapsed;

  return (
    <div className="lucy-approve">
      <div className="row wrap">
        <Action className="primary" disabled={disabled} working="Checking…" run={() => ask('draft')}>Save as draft</Action>
        <Action disabled={disabled} working="Checking…" run={() => ask('draft_and_play')}>Save and play</Action>
      </div>
      {!isCurrent && <p className="hint">Make this the current revision to approve it</p>}
      {pending.current && pending.current.revision !== revision.id && (
        <div className="problem" role="status">
          <p>An earlier revision has a save whose result is still being checked. Resolve it before saving another revision; nothing will be sent twice.</p>
          <Action working="Checking…" run={() => pending.current && reconcile(pending.current)}>Check earlier save</Action>
        </div>
      )}
      {isCurrent && blocked && <p className="hint">{blocked}</p>}
      {isCurrent && !blocked && !outcome && <p className="hint">Saving makes a draft from exactly these songs. Save and play also replaces what’s playing, after you confirm.</p>}

      {outcome?.state === 'saving' && <p className="hint" role="status">Saving…</p>}
      {outcome?.state === 'checking' && <p className="hint" role="status">Checking whether it was saved…</p>}
      {outcome?.state === 'saved' && (
        <div className="lucy-saved" role="status">
          <LifecyclePill stage={outcome.commit.played ? 'playing' : 'draft'} />
          <p>
            Saved as draft “{outcome.commit.name ?? 'Untitled'}”.
            {outcome.action === 'draft_and_play' && (outcome.commit.played
              ? outcome.startedHere ? ' It’s playing now.' : ' It’s your current mix now.'
              : ' It isn’t playing: what was playing was left alone.')}
          </p>
          {!!outcome.commit.problems?.length && <ul className="lucy-warnings">{outcome.commit.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
          <div className="row wrap">
            {outcome.commit.played
              ? <PageLink className="button" to="/mix/current/edit">Open in editor</PageLink>
              : outcome.commit.draft_id !== null && <PageLink className="button" to={`/mixes/drafts/${outcome.commit.draft_id}/edit`}>Open in editor</PageLink>}
            <PageLink className="button" to="/mixes/mine">My Mixes</PageLink>
          </div>
        </div>
      )}
      {outcome?.state === 'failed' && (
        <div className="problem" role="alert">
          <p>{outcome.message}</p>
          {outcome.problems.length > 0 && <ul>{outcome.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      )}
      {outcome?.state === 'not-received' && pending.current && (
        <div className="problem" role="alert">
          <p>Selecta didn’t receive that, so nothing was saved.</p>
          <Action working="Sending…" run={() => pending.current && submit(pending.current)}>Try again</Action>
        </div>
      )}
      {outcome?.state === 'unknown' && pending.current && (
        <div className="problem" role="alert">
          <p>Couldn’t find out whether it was saved. {outcome.message} Nothing will be sent twice.</p>
          <Action working="Checking…" run={() => pending.current && reconcile(pending.current)}>Check again</Action>
        </div>
      )}

      {activeApproval && preflight && (
        <NativeDialog
          title={playing ? 'Save this mix and play it?' : 'Save this mix as a draft?'}
          onClose={() => setApproval(null)}
          footer={(
            <>
              <button type="button" data-autofocus onClick={() => setApproval(null)}>Cancel</button>
              <Action className="primary" disabled={!canConfirm} working="Saving…" run={confirm}>{playing ? 'Save and play' : 'Save as draft'}</Action>
            </>
          )}
        >
          <dl className="lucy-facts">
            <div><dt>Name</dt><dd dir="auto">{preflight.title || 'Untitled mix'}</dd></div>
            {typeof revision.number === 'number' && <div><dt>Revision</dt><dd>{revision.number} (current)</dd></div>}
            <div><dt>Songs</dt><dd>{preflight.songs}</dd></div>
            <div><dt>Transitions ready</dt><dd>{preflight.ready} of {preflight.needed}</dd></div>
            <div><dt>Only transitions that are already ready</dt><dd>{preflight.ready_only ? 'Yes, this rule is on' : 'No'}</dd></div>
          </dl>
          {missingStrictEdges && <p className="warn" role="alert">This ready-only mix is missing {preflight.needed - preflight.ready} verified transition{preflight.needed - preflight.ready === 1 ? '' : 's'}. Nothing will be saved; change the plan and check again.</p>}
          {problems.length > 0 && (
            <div className="problem" role="alert">
              <p><b>This can’t be saved yet:</b></p>
              <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          )}
          {lapsed && <p className="warn" role="alert">This check has run out. Close this and press the button again.</p>}
          {playing ? (
            <>
              <p><b>This replaces what’s playing now.</b></p>
              <label className="choice">
                <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
                Yes, replace what’s playing with this mix
              </label>
            </>
          ) : (
            <p className="hint">Saving doesn’t change what’s playing.</p>
          )}
        </NativeDialog>
      )}
    </div>
  );
}
