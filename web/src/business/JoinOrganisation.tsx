// The invitation page (`/business/join#token`, ADR-0452 BZ-0452-05). The token rides in the
// address's hash, so it never reaches a server log or a referrer; the page sends it once to
// `POST /api/business/invitations/accept` and then opens the organisation. A link sent to a
// different email address, an expired one or a revoked one says so plainly.

import { useEffect, useRef, useState } from 'react';
import type { Api } from '../cloud/api';
import { businessClient } from './client';
import { PATHS } from './context';
import './business.css';

type State = { kind: 'joining' } | { kind: 'joined'; org: string } | { kind: 'problem'; words: string };

export function joinProblem(problem: unknown): string {
  const code = (problem as { code?: string })?.code;
  if (code === 'wrong_email') return 'This invitation was sent to a different email address. Sign in with that address, or ask for a new invitation.';
  if (code === 'expired') return 'This invitation has expired. Ask the person who invited you for a new one.';
  if ((problem as { status?: number })?.status === 404) return 'This invitation is no longer valid. It may have been replaced or withdrawn.';
  if (code === 'flag_off') return 'Joining an organisation is not available on this account yet.';
  return "We couldn't accept this invitation just now. Try again in a moment.";
}

export default function JoinOrganisation({ api, onOpen }: { api: Api; onOpen: (path: string) => void }) {
  const token = useRef(window.location.hash.replace(/^#/, ''));
  const [state, setState] = useState<State>(() => (token.current ? { kind: 'joining' } : { kind: 'problem', words: 'This invitation link is incomplete. Open the whole link you were sent.' }));
  useEffect(() => {
    if (!token.current) return;
    let live = true;
    // The token leaves the address at once, so a shared screen or a reload cannot reuse it.
    window.history.replaceState({}, '', window.location.pathname);
    businessClient(api).acceptInvitation(token.current)
      .then((joined) => { if (live) setState({ kind: 'joined', org: joined.org_id }); })
      .catch((problem) => { if (live) setState({ kind: 'problem', words: joinProblem(problem) }); });
    return () => { live = false; };
  }, [api]);
  useEffect(() => { if (state.kind === 'joined') onOpen(PATHS.hq(state.org)); }, [state, onOpen]);
  return (
    <main className="biz biz-runtime">
      <h1>Join an organisation on SelectaDJ</h1>
      {state.kind === 'joining' && <p role="status">Accepting your invitation…</p>}
      {state.kind === 'joined' && <p role="status">You've joined. Opening the organisation…</p>}
      {state.kind === 'problem' && <p role="alert">{state.words}</p>}
      {state.kind === 'problem' && <button type="button" onClick={() => onOpen('/')}>Go to your own SelectaDJ</button>}
    </main>
  );
}
