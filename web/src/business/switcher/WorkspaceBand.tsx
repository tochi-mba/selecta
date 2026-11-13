// The WorkspaceBand (ADR-0453 D9, BZ-0453-17): a thin band at the top of every business page (and
// the personal app when someone belongs to an organisation) naming the workspace, with a building
// mark for business and the role in words, so nobody mistakes a business page for their own
// library. Colour is never the only signal: the mark, the name and the words all change.

import type { ReactNode } from 'react';
import { roleWords, SHELL_COPY } from '../copy/shell';
import './switcher.css';

/** A small building, drawn inline (the icon set has none). Decorative: the words say the same. */
export function BuildingMark() {
  return (
    <svg className="ws-mark" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 18V4.5L11 2v16M11 7.5l6 2V18M2 18h16M6 6.5h2M6 9.5h2M6 12.5h2M13.5 11.5h1.5M13.5 14.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonMark() {
  return (
    <svg className="ws-mark" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="10" cy="6.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 17.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function WorkspaceBand({ kind, name, role, marks, children }: {
  kind: 'personal' | 'business';
  name: string;
  role?: string | null;
  /** Extra marks after the name (a PilotBadge, "Read only"). */
  marks?: ReactNode;
  /** The switcher, at the end of the band. */
  children?: ReactNode;
}) {
  const business = kind === 'business';
  const words = role ? roleWords(role) : '';
  return (
    <div className={`ws-band ws-band-${kind}`} data-workspace-band={kind} role="group" aria-label={`${business ? SHELL_COPY.businessMark : SHELL_COPY.personalMark}: ${name}${words ? `, ${words}` : ''}`}>
      <span className="ws-band-name">
        {business ? <BuildingMark /> : <PersonMark />}
        <span className="ws-band-kind">{business ? 'Business' : 'Personal'}</span>
        <strong>{name}</strong>
        {business && words && <span className="ws-band-role">{SHELL_COPY.roleLine(words)}</span>}
        {marks}
      </span>
      {children && <span className="ws-band-end">{children}</span>}
    </div>
  );
}
