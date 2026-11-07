import { useEffect, useState } from 'react';
import { ActivityEntry, blockedBy, clearFinishedActivity, markActivitySeen, runUndo, useActivity } from '../state/activity';
import { Action, Status } from './controls';
import { PageLink } from '../shell/PageLink';

function when(at: number, now: number): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
}

function Row({ entry, all, now }: { entry: ActivityEntry; all: ActivityEntry[]; now: number }) {
  const newer = blockedBy(entry, all);
  return (
    <li className={`activity-row ${entry.tone}`}>
      <div>
        <p>{entry.message}</p>
        <small className="soft">{when(entry.at, now)}</small>
      </div>
      {entry.undoState === 'available' && !newer && (
        <Action working="Undoing…" aria-label={`Undo: ${entry.message}`} run={() => runUndo(entry.id)}>Undo</Action>
      )}
      {entry.undoState === 'available' && newer && (
        <small className="hint">
          {newer.undoState === 'failed'
            ? 'A newer Undo failed. Check the mix before attempting to undo an older change.'
            : newer.undoState === 'running'
              ? 'A newer Undo is still running.'
              : 'Undo the newer change in this mix first.'}
        </small>
      )}
      {entry.undoState === 'running' && <Status kind="working">Undoing</Status>}
      {entry.undoState === 'undone' && <Status kind="ready">Undone</Status>}
      {entry.undoState === 'failed' && (
        <div className="activity-failed">
          <Status kind="failed">Couldn’t undo</Status>
          {entry.problem && <small className="hint">{entry.problem}</small>}
          {newer ? (
            <small className="hint">A newer change in this mix must be resolved first.</small>
          ) : (
            <div className="row wrap">
              <Action working="Trying again…" run={() => runUndo(entry.id)}>Try Undo again</Action>
              {entry.scope && (
                <PageLink to={entry.scope.startsWith('draft:')
                  ? `/mixes/drafts/${entry.scope.slice(6)}/edit`
                  : '/mix/current/edit'}>Check this mix</PageLink>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** What's happened lately and what can still be taken back, since a toast is gone in seconds. Lives in
 * this tab, so it starts empty after a reload. Undo in Edit still works then. */
export function ActivityPanel() {
  const entries = useActivity();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    markActivitySeen();
  }, [entries]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (!entries.length) {
    return <p className="hint">Nothing yet. Changes you make show up here, with a way to undo them.</p>;
  }
  const finished = entries.some((entry) => entry.undoState === 'undone');
  return (
    <section className="activity" aria-label="Recent activity">
      <ul className="activity-list">
        {entries.map((entry) => <Row key={entry.id} entry={entry} all={entries} now={now} />)}
      </ul>
      {finished && <button onClick={clearFinishedActivity}>Clear finished</button>}
    </section>
  );
}
