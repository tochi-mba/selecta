// LicenceAttestationForm (ADR-0453 D6 step 5, ADR-0449): licence type, number, end date and a
// plain-words rights tick box. A past date is refused; a date within 30 days saves with the
// reminder promise. Until it is confirmed no zone in the venue plays music. Used on S1 and S3.

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Action, Status } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { LICENCE_COPY } from '../copy/onboarding';
import { daysUntil, LICENCE_WARN_DAYS } from '../state';
import { isoDayWords } from '../time';
import type { Licence } from '../types';
import './forms.css';

export type LicenceCheck = { ok: true; soon: boolean } | { ok: false; error: string };

/** Past dates refuse; within 30 days warns (D6 S1 matrix). */
export function checkExpiry(isoDate: string, now: number): LicenceCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return { ok: false, error: LICENCE_COPY.needDate };
  const days = daysUntil(isoDate, now);
  if (days < 0) return { ok: false, error: LICENCE_COPY.past };
  return { ok: true, soon: days <= LICENCE_WARN_DAYS };
}

export function LicenceAttestationForm({ initial, now, onSave, disabled, onDraft, submitLabel = LICENCE_COPY.save }: {
  initial?: Licence | null;
  now: number;
  onSave: (l: Licence & { rights_confirmed: true }) => Promise<void>;
  disabled?: string | null;
  onDraft?: (l: Partial<Licence> & { rights?: boolean }) => void;
  submitLabel?: string;
}) {
  const [kind, setKind] = useState<Licence['kind']>(initial?.kind ?? 'themusiclicence');
  const [otherName, setOtherName] = useState(initial?.other_name ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [expires, setExpires] = useState(initial?.expires_on ?? '');
  const [rights, setRights] = useState(false);
  const [errors, setErrors] = useState<{ number?: string; other?: string; date?: string; rights?: string }>({});
  const off = Boolean(disabled);
  const check = expires ? checkExpiry(expires, now) : null;

  const draftRef = useRef(onDraft);
  draftRef.current = onDraft;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    draftRef.current?.({ kind, other_name: otherName || null, number, expires_on: expires, rights });
  }, [kind, otherName, number, expires, rights]);

  const submit = async () => {
    const dateCheck = checkExpiry(expires, now);
    const next = {
      number: number.trim() ? undefined : LICENCE_COPY.needNumber,
      other: kind === 'other' && !otherName.trim() ? LICENCE_COPY.needOtherName : undefined,
      date: dateCheck.ok ? undefined : dateCheck.error,
      rights: rights ? undefined : LICENCE_COPY.needRights,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    await onSave({ kind, other_name: kind === 'other' ? otherName.trim() : null, number: number.trim(), expires_on: expires, rights_confirmed: true });
  };

  return <form className="bzf-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(); }} noValidate>
    <p className="bzf-note"><Status kind="needs-action">Before music plays</Status> {LICENCE_COPY.noPlayUntil}</p>
    <Select label={LICENCE_COPY.kind} value={kind} onChange={setKind} disabled={off} options={[{ value: 'themusiclicence', label: LICENCE_COPY.tml }, { value: 'other', label: LICENCE_COPY.other }]} />
    {kind === 'other' && <TextField label={LICENCE_COPY.otherName} value={otherName} onChange={setOtherName} disabled={off} required error={errors.other} />}
    <TextField label={LICENCE_COPY.number} value={number} onChange={setNumber} disabled={off} required error={errors.number} />
    <div className="field">
      <label htmlFor="bzf-licence-date">{LICENCE_COPY.expires}</label>
      <input id="bzf-licence-date" type="date" value={expires} disabled={off} onChange={(event) => { setExpires(event.target.value); setErrors((prev) => ({ ...prev, date: undefined })); }} aria-invalid={errors.date || (check && !check.ok) ? true : undefined} aria-describedby="bzf-licence-date-note" />
      <div id="bzf-licence-date-note">
        {(errors.date || (check && !check.ok)) && <p className="warn" role="alert">{errors.date ?? (check && !check.ok ? check.error : '')}</p>}
        {check?.ok && check.soon && <p className="bzf-note" role="status"><Status kind="warning">Ends soon</Status> {LICENCE_COPY.soon(isoDayWords(expires))}</p>}
      </div>
    </div>
    <label className="bzf-check bzf-rights">
      <input type="checkbox" checked={rights} disabled={off} onChange={(event) => setRights(event.target.checked)} aria-invalid={errors.rights ? true : undefined} aria-describedby={errors.rights ? 'bzf-rights-error' : undefined} />
      <span>{LICENCE_COPY.rights}</span>
    </label>
    {errors.rights && <p className="warn" role="alert" id="bzf-rights-error">{errors.rights}</p>}
    {disabled && <p className="biz-quiet">{disabled}</p>}
    <div className="biz-row"><Action type="button" className="primary" run={submit} disabled={off} title={disabled ?? undefined} working="Saving">{submitLabel}</Action></div>
  </form>;
}
