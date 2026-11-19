// What music licence a venue needs, in plain words with the licensing bodies' own sites
// (ADR-0449 BZ-0449-08). Shown with the licence form in onboarding and on the venue's Licence tab.

import { LICENCE_GUIDE as COPY } from '../copy/console';

export function LicenceGuide() {
  return <details className="bzf-guide">
    <summary>{COPY.summary}</summary>
    <p>{COPY.intro}</p>
    {COPY.territories.map((place) => <section key={place.name}>
      <h3>{place.name}</h3>
      <p>{place.words}</p>
      <ul className="biz-row">{place.links.map((link) => <li key={link.href}><a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a></li>)}</ul>
    </section>)}
  </details>;
}
