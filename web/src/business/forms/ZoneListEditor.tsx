// ZoneListEditor (ADR-0453 D6 step 4, D14): name each zone. The first zones are included; before
// adding one beyond them the price shows (or the pilot allowance, or the trial's one-zone lock),
// so nobody adds a cost by surprise (ADR-0447, ADR-0448). Used on S1 and S3.

import { useState } from 'react';
import { Action, Status } from '../../ui/controls';
import { TextField } from '../../ui/formControls';
import { ZONE_COPY } from '../copy/onboarding';
import type { Zone } from '../types';
import './forms.css';

export function ZoneListEditor({ zones, included, extraPrice, allowance, onAdd, onRename, disabled }: {
  zones: Zone[];
  /** Zones included in the plan before any extra cost (1 per venue on Business). */
  included: number;
  /** "£25" for each extra zone; null when extra zones cannot be bought here (the trial). */
  extraPrice?: string | null;
  /** A pilot's zone allowance; when set it replaces the price. */
  allowance?: number | null;
  onAdd: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  disabled?: string | null;
}) {
  const [name, setName] = useState(zones.length ? '' : 'Bar');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const off = Boolean(disabled);
  const count = zones.length;

  const pilot = allowance != null;
  const atLimit = pilot ? count >= allowance : count >= included && !extraPrice;
  const nextIsExtra = !pilot && count >= included && Boolean(extraPrice);
  const lockWords = pilot ? ZONE_COPY.pilotCovers(allowance) : ZONE_COPY.trialOneZone;

  const add = async () => {
    if (!name.trim()) { setError(ZONE_COPY.needName); return; }
    setError('');
    await onAdd(name.trim());
    setName('');
  };

  return <div className="bzf-zones">
    {!count ? <p className="biz-quiet">{ZONE_COPY.empty}</p> : (
      <ul className="bzf-zone-list" aria-label={ZONE_COPY.list}>
        {zones.map((zone, index) => <li key={zone.id} className="bzf-zone">
          {editing === zone.id ? <div className="biz-row">
            <TextField label={ZONE_COPY.rename(zone.name)} value={rename} onChange={setRename} />
            <Action run={async () => { if (rename.trim()) await onRename(zone.id, rename.trim()); setEditing(null); }} working="Saving">{ZONE_COPY.saveName}</Action>
          </div> : <>
            <strong className="biz-clamp" title={zone.name}>{zone.name}</strong>
            <span className="biz-quiet">{pilot || index < included ? ZONE_COPY.included : extraPrice ? ZONE_COPY.extraAdded(extraPrice) : ZONE_COPY.included}</span>
            <button type="button" disabled={off} onClick={() => { setEditing(zone.id); setRename(zone.name); }}>{ZONE_COPY.rename(zone.name)}</button>
          </>}
        </li>)}
      </ul>
    )}
    {atLimit ? <p className="bzf-lock" data-plan-locked=""><Status kind="unavailable">Plan</Status> {lockWords}</p> : <div className="bzf-add-zone">
      {pilot && <p className="biz-quiet">{ZONE_COPY.pilotLeft(allowance - count, allowance)}</p>}
      {nextIsExtra && extraPrice && <p className="bzf-price" data-price=""><Status kind="planned">Price</Status> {ZONE_COPY.extra(extraPrice)}</p>}
      <div className="biz-row">
        <TextField label={ZONE_COPY.newName} value={name} onChange={setName} disabled={off} error={error} />
        <Action run={add} disabled={off} title={disabled ?? undefined} working="Adding">{nextIsExtra && extraPrice ? `${ZONE_COPY.add} for ${extraPrice} a month` : ZONE_COPY.add}</Action>
      </div>
    </div>}
    {disabled && <p className="biz-quiet">{disabled}</p>}
  </div>;
}
