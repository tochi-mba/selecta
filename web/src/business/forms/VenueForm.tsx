// Venue details shared by onboarding and the venue creation screen.

import { FormEvent, useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { VENUE_COPY } from '../copy/onboarding';
import type { Venue } from '../types';
import './forms.css';

export type VenueFields = Pick<Venue, 'name' | 'address' | 'time_zone' | 'phone'>;

const FALLBACK_ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try { const all = intl.supportedValuesOf?.('timeZone'); if (all?.length) return all; } catch { /* older browser */ }
  return FALLBACK_ZONES;
}

export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch { return 'Europe/London'; } };

/** Address as one line, from the manual fields. */
export function joinAddress(line1: string, city: string, postcode: string) {
  return [line1, city, postcode].map((part) => part.trim()).filter(Boolean).join(', ');
}

export function VenueForm({ initial, onSave, disabled, submitLabel = VENUE_COPY.save }: {
  initial?: Partial<Venue>;
  onSave: (v: VenueFields) => Promise<void>;
  disabled?: string | null;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const parts = useMemo(() => (initial?.address ?? '').split(',').map((part) => part.trim()), [initial?.address]);
  const [line1, setLine1] = useState(parts.length > 2 ? parts.slice(0, -2).join(', ') : parts[0] ?? '');
  const [city, setCity] = useState(parts.length > 2 ? parts[parts.length - 2] : parts[1] ?? '');
  const [postcode, setPostcode] = useState(parts.length > 2 ? parts[parts.length - 1] : '');
  const [zone, setZone] = useState(initial?.time_zone || browserZone());
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [errors, setErrors] = useState<{ name?: string; address?: string }>({});
  const zones = useMemo(() => { const all = timeZones(); return all.includes(zone) ? all : [zone, ...all]; }, [zone]);
  const off = Boolean(disabled);

  const fields = (): VenueFields => ({ name: name.trim(), address: joinAddress(line1, city, postcode), time_zone: zone, phone: phone.trim() || null });
  const submit = async () => {
    const next = { name: name.trim() ? undefined : VENUE_COPY.needName, address: line1.trim() && city.trim() ? undefined : VENUE_COPY.needAddress };
    setErrors(next);
    if (next.name || next.address) return;
    await onSave(fields());
  };

  return <form className="bzf-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(); }} noValidate>
    <TextField label={VENUE_COPY.name} value={name} onChange={setName} required disabled={off} error={errors.name} />
    <fieldset className="bzf-address" disabled={off}>
      <legend>Address</legend>
      <TextField label={VENUE_COPY.line1} value={line1} onChange={setLine1} required error={errors.address} />
      <div className="bzf-two">
        <TextField label={VENUE_COPY.city} value={city} onChange={setCity} required />
        <TextField label={VENUE_COPY.postcode} value={postcode} onChange={setPostcode} />
      </div>
    </fieldset>
    <Select label={VENUE_COPY.timeZone} help={VENUE_COPY.timeZoneHelp} value={zone} onChange={setZone} disabled={off} options={zones.map((item) => ({ value: item, label: item.replace(/_/g, ' ') }))} />
    <TextField label={VENUE_COPY.phone} help={VENUE_COPY.phoneHelp} value={phone} onChange={setPhone} disabled={off} />
    {disabled && <p className="biz-quiet">{disabled}</p>}
    <div className="biz-row"><Action type="button" className="primary" run={submit} disabled={off} title={disabled ?? undefined} working="Saving">{submitLabel}</Action></div>
  </form>;
}
