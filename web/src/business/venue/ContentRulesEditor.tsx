// ContentRulesEditor (ADR-0450, ADR-0453 D14): explicit songs, allowed crates per zone and
// daypart, the brand BPM and energy range, volume caps and quiet hours. Rules only narrow; the
// server refuses a save that leaves a block with nothing to play, and the editor shows that refusal.

import { useEffect, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { VENUE_COPY } from '../copy/venue';
import { clock } from '../time';
import type { ContentRules, Daypart, Zone } from '../types';

export type CrateChoice = { id: string; name: string };

const toTime = (minutes: number) => clock(minutes, false);
const fromTime = (text: string) => {
  const [h, m] = text.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
const numberOrNull = (text: string) => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));

function CratePicker({ legend, crates, chosen, onChange, disabled }: { legend: string; crates: CrateChoice[]; chosen: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  return <fieldset className="venue-crates" disabled={disabled}>
    <legend>{legend}</legend>
    {!chosen.length && <p className="biz-quiet">{VENUE_COPY.allCrates}</p>}
    {crates.map((crate) => <label key={crate.id} className="venue-check">
      <input type="checkbox" checked={chosen.includes(crate.id)} onChange={(event) => onChange(event.target.checked ? [...chosen, crate.id] : chosen.filter((id) => id !== crate.id))} />
      <span>{crate.name}</span>
    </label>)}
  </fieldset>;
}

export function ContentRulesEditor({ rules, zones, crates, dayparts = {}, onSave, disabled, refusal }: {
  rules: ContentRules;
  zones: Zone[];
  crates: CrateChoice[];
  /** Each zone's dayparts, so crates can be narrowed per block. */
  dayparts?: Record<string, Daypart[]>;
  onSave: (rules: ContentRules) => Promise<void>;
  disabled?: string | null;
  /** The server's refusal, already in words ("Nothing can play in Terrace with these rules..."). */
  refusal?: string | null;
}) {
  const [draft, setDraft] = useState<ContentRules>(rules);
  useEffect(() => setDraft(rules), [rules]);
  const off = disabled != null;
  const update = (change: Partial<ContentRules>) => setDraft((current) => ({ ...current, ...change }));
  const cratesFor = (zoneId: string, daypartId: string | null) => draft.allowed_crates.find((item) => item.zone_id === zoneId && (item.daypart_id ?? null) === daypartId)?.crate_ids ?? [];
  const setCrates = (zoneId: string, daypartId: string | null, ids: string[]) => update({
    allowed_crates: [...draft.allowed_crates.filter((item) => !(item.zone_id === zoneId && (item.daypart_id ?? null) === daypartId)), ...(ids.length ? [{ zone_id: zoneId, daypart_id: daypartId, crate_ids: ids }] : [])],
  });
  const { bpm_min, bpm_max } = draft.brand;
  const bpmError = bpm_min != null && bpm_max != null && bpm_min >= bpm_max ? VENUE_COPY.bpmOrder : undefined;
  return <form className="biz-stack" aria-labelledby="rules-title" onSubmit={(event) => event.preventDefault()}>
    <h3 id="rules-title">{VENUE_COPY.rulesHeading}</h3>
    {refusal && <p className="warn" role="alert">{refusal}</p>}
    <Select label={VENUE_COPY.explicitLabel} value={draft.explicit} disabled={off} onChange={(explicit) => update({ explicit })}
      options={[{ value: 'block', label: VENUE_COPY.explicitBlock }, { value: 'block_daytime', label: VENUE_COPY.explicitDaytime }, { value: 'allow', label: VENUE_COPY.explicitAllow }]} />

    {zones.map((zone) => <div key={zone.id} className="biz-stack">
      <CratePicker legend={VENUE_COPY.allowedCrates(zone.name)} crates={crates} chosen={cratesFor(zone.id, null)} disabled={off} onChange={(ids) => setCrates(zone.id, null, ids)} />
      {(dayparts[zone.id] ?? []).map((part) => (
        <CratePicker key={part.id} legend={VENUE_COPY.allowedCratesDaypart(zone.name, part.name)} crates={crates} chosen={cratesFor(zone.id, part.id)} disabled={off} onChange={(ids) => setCrates(zone.id, part.id, ids)} />
      ))}
    </div>)}

    <fieldset className="venue-fields" disabled={off}>
      <legend>{VENUE_COPY.brandHeading}</legend>
      <TextField type="number" label={VENUE_COPY.bpmMin} value={bpm_min == null ? '' : String(bpm_min)} disabled={off} onChange={(text) => update({ brand: { ...draft.brand, bpm_min: numberOrNull(text) } })} />
      <TextField type="number" label={VENUE_COPY.bpmMax} value={bpm_max == null ? '' : String(bpm_max)} error={bpmError} disabled={off} onChange={(text) => update({ brand: { ...draft.brand, bpm_max: numberOrNull(text) } })} />
      <TextField type="number" label={VENUE_COPY.energyMax} value={draft.brand.energy_max == null ? '' : String(draft.brand.energy_max)} disabled={off} onChange={(text) => update({ brand: { ...draft.brand, energy_max: numberOrNull(text) } })} />
    </fieldset>

    <fieldset className="venue-fields" disabled={off}>
      <legend>{VENUE_COPY.quietHours}</legend>
      {zones.map((zone) => {
        const cap = draft.volume_caps[zone.id] ?? zone.volume_cap ?? 100;
        const quiet = draft.quiet_hours.find((item) => item.zone_id === zone.id);
        const setQuiet = (change: Partial<ContentRules['quiet_hours'][number]> | null) => update({
          quiet_hours: [...draft.quiet_hours.filter((item) => item.zone_id !== zone.id), ...(change ? [{ zone_id: zone.id, start: 1380, end: 420, cap: Math.min(30, cap), ...quiet, ...change }] : [])],
        });
        return <div key={zone.id} className="venue-quiet">
          <TextField type="number" label={VENUE_COPY.volumeCap(zone.name)} value={String(cap)} disabled={off} onChange={(text) => update({ volume_caps: { ...draft.volume_caps, [zone.id]: Math.max(0, Math.min(100, Number(text) || 0)) } })} />
          {quiet ? <>
            <label className="field">{VENUE_COPY.quietFrom(zone.name)}<input type="time" value={toTime(quiet.start)} disabled={off} onChange={(event) => setQuiet({ start: fromTime(event.target.value) })} /></label>
            <label className="field">{VENUE_COPY.quietTo(zone.name)}<input type="time" value={toTime(quiet.end)} disabled={off} onChange={(event) => setQuiet({ end: fromTime(event.target.value) })} /></label>
            <TextField type="number" label={VENUE_COPY.quietCap(zone.name)} value={String(quiet.cap)} disabled={off} onChange={(text) => setQuiet({ cap: Math.max(0, Math.min(cap, Number(text) || 0)) })} />
            <button type="button" disabled={off} onClick={() => setQuiet(null)}>{VENUE_COPY.removeQuiet(zone.name)}</button>
          </> : <button type="button" disabled={off} onClick={() => setQuiet({})}>{VENUE_COPY.addQuiet(zone.name)}</button>}
        </div>;
      })}
    </fieldset>

    <div className="biz-row">
      <Action className="primary" disabled={off || bpmError != null} run={() => onSave(draft)}>{VENUE_COPY.saveRules}</Action>
      {disabled && <span className="biz-quiet">{disabled}</span>}
    </div>
  </form>;
}
