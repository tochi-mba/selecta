// RequestApprovalQueue (ADR-0453 D10, D14): guests' requests for one zone. Each shows the song,
// the artist, how long it has waited, the guest's nickname (never anything else about them) and
// the votes as a count, with Approve and Pass. On S4 the buttons are BigActions.
//
// The feel (ADR-0477 plan 3.14): a request that arrives while the queue is open glows once; an
// approved one shows a drawn tick and folds away, a passed one folds away. With motion off the row
// goes the moment the answer lands, exactly as before.

import { useRef, useState } from 'react';
import { DrawnTick, foldAway, unfoldIfKept } from '../../views/feelPieces';
import { feelCalm, feelOn } from '../../feel/root';
import { motionMs } from '../../ui/exitMotion';
import type { GuestRequest } from '../types';
import { requestedBy, STAFF_COPY, votesWords, waitedWords } from '../copy/staff';
import { useLiveFlash } from '../feelBits';
import { BigAction } from './BigAction';
import './staff.css';

export function RequestApprovalQueue({ requests, onDecide, onDecided, big = false, disabled }: {
  requests: GuestRequest[];
  /** Sends the answer. Resolving false means it was not taken (the caller already said why), so
   * the row stays. */
  onDecide: (id: string, verdict: 'approve' | 'pass') => Promise<void | false>;
  /** Reads the queue again once the answered row has gone, so a fold is never cut short. */
  onDecided?: () => Promise<unknown> | unknown;
  big?: boolean;
  disabled?: string | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [approved, setApproved] = useState<string | null>(null);
  useLiveFlash(list, requests.map((request) => request.id));
  if (!requests.length) return <p className="biz-quiet biz-requests-empty">{STAFF_COPY.noRequests}</p>;

  const row = (id: string) => list.current?.querySelector(`[data-live-key="${CSS.escape(id)}"]`) ?? null;
  const decide = async (id: string, verdict: 'approve' | 'pass') => {
    if ((await onDecide(id, verdict)) === false) return;
    if (feelOn('motion') && !feelCalm()) {
      if (verdict === 'approve') {
        // let the tick draw before the row folds, so the answer is seen and not only heard
        setApproved(id);
        await new Promise((done) => window.setTimeout(done, motionMs('--motion-spring-snappy', 320)));
      }
      const folded = row(id);
      await foldAway(folded);
      // a queue read again that still holds the row (someone else answered it back) shows it again
      unfoldIfKept(folded);
    }
    await onDecided?.();
  };

  return (
    <ul ref={list} className="biz-requests" aria-label={STAFF_COPY.requestsTitle}>
      {requests.map((request) => {
        const song = `${request.title} by ${request.artist}`;
        return (
          <li key={request.id} className="biz-request" data-live-key={request.id}>
            <span className="biz-now" title={song}>
              <span className="biz-now-title">{approved === request.id && <DrawnTick className="biz-request-tick" />}{request.title}</span>
              <span className="biz-now-artist">{request.artist}</span>
            </span>
            <p className="biz-quiet biz-request-meta">
              <span>{requestedBy(request.nickname)}</span>
              <span>{waitedWords(request.waited_seconds)}</span>
              <span>{votesWords(request.votes)}</span>
              {/* ADR-0488: the line the guest chose, so staff see it before it reaches the room */}
              {request.dedication && <span>Dedication: {request.dedication}</span>}
            </p>
            <div className="biz-request-actions">
              <BigAction big={big} disabled={disabled} aria-label={`${STAFF_COPY.approve} ${song}`} run={() => decide(request.id, 'approve')}>{STAFF_COPY.approve}</BigAction>
              <BigAction big={big} disabled={disabled} aria-label={`${STAFF_COPY.pass} ${song}`} run={() => decide(request.id, 'pass')}>{STAFF_COPY.pass}</BigAction>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
