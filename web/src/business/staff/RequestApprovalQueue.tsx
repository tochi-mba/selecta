// RequestApprovalQueue (ADR-0453 D10, D14): guests' requests for one zone. Each shows the song,
// the artist, how long it has waited, the guest's nickname (never anything else about them) and
// the votes as a count, with Approve and Pass. On S4 the buttons are BigActions.

import type { GuestRequest } from '../types';
import { requestedBy, STAFF_COPY, votesWords, waitedWords } from '../copy/staff';
import { BigAction } from './BigAction';
import './staff.css';

export function RequestApprovalQueue({ requests, onDecide, big = false, disabled }: {
  requests: GuestRequest[];
  onDecide: (id: string, verdict: 'approve' | 'pass') => Promise<void>;
  big?: boolean;
  disabled?: string | null;
}) {
  if (!requests.length) return <p className="biz-quiet biz-requests-empty">{STAFF_COPY.noRequests}</p>;
  return (
    <ul className="biz-requests" aria-label={STAFF_COPY.requestsTitle}>
      {requests.map((request) => {
        const song = `${request.title} by ${request.artist}`;
        return (
          <li key={request.id} className="biz-request">
            <span className="biz-now" title={song}>
              <span className="biz-now-title">{request.title}</span>
              <span className="biz-now-artist">{request.artist}</span>
            </span>
            <p className="biz-quiet biz-request-meta">
              <span>{requestedBy(request.nickname)}</span>
              <span>{waitedWords(request.waited_seconds)}</span>
              <span>{votesWords(request.votes)}</span>
            </p>
            <div className="biz-request-actions">
              <BigAction big={big} disabled={disabled} aria-label={`${STAFF_COPY.approve} ${song}`} run={() => onDecide(request.id, 'approve')}>{STAFF_COPY.approve}</BigAction>
              <BigAction big={big} disabled={disabled} aria-label={`${STAFF_COPY.pass} ${song}`} run={() => onDecide(request.id, 'pass')}>{STAFF_COPY.pass}</BigAction>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
