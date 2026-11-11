import { LinkIfThere } from '../shell/PageLink';
import { AREA_WORDS, detectFaults } from '../state/selfService';
import { Status } from '../ui/controls';

/** GP-0263: each fault Selecta measured, with what it stops, what is known about why, and one scoped
 * step. A confirmed cause and a likely one are labelled differently, and nothing is listed for a
 * dependency that is present. */
export function WhatWentWrong({ info }: { info: Record<string, unknown> }) {
  const faults = detectFaults(info);
  return (
    <section className="stack what-went-wrong" aria-labelledby="what-went-wrong">
      <h3 id="what-went-wrong">What went wrong</h3>
      {faults.length === 0
        ? <p><Status kind="ready">Nothing Selecta checks for is wrong right now.</Status></p>
        : (
          <ul className="needs-you-list">
            {faults.map((fault) => (
              <li key={fault.id} data-fault={fault.id} data-certainty={fault.certainty}>
                <Status kind={fault.certainty === 'verified' ? 'needs-action' : 'warning'}>
                  {AREA_WORDS[fault.area]}: {fault.operation}{fault.count ? ` (${fault.count})` : ''}
                </Status>
                <p>
                  <b>{fault.certainty === 'verified' ? 'Confirmed cause: ' : 'Possible cause, not confirmed: '}</b>
                  {fault.cause}
                </p>
                <p className="hint">{fault.repair}</p>
                {fault.to && fault.action && <LinkIfThere to={fault.to}>{fault.action}</LinkIfThere>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
