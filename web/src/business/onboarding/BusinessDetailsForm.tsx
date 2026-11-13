// Business details (ADR-0453 D6 step 1, ADR-0447): organisation name, country, billing email,
// optional VAT number (loosely checked by country format) and optional PO number. Used by the
// trial start page and by step 1 of setup.

import { useEffect, useRef, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { BUSINESS_COPY } from '../copy/onboarding';
import '../forms/forms.css';

export type BusinessDetails = { name: string; country: string; billing_email: string; vat_number?: string; po_number?: string };

export const COUNTRIES: { value: string; label: string }[] = [
  { value: 'GB', label: 'United Kingdom' }, { value: 'IE', label: 'Ireland' }, { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' }, { value: 'ES', label: 'Spain' }, { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' }, { value: 'US', label: 'United States' }, { value: 'OTHER', label: 'Another country' },
];
const EU = ['IE', 'FR', 'DE', 'ES', 'IT', 'NL'];

/** A loose VAT number check by country (the server checks it properly). Empty is fine. */
export function vatLooksRight(country: string, vat: string): boolean {
  const clean = vat.replace(/[\s.-]/g, '').toUpperCase();
  if (!clean) return true;
  if (country === 'GB') return /^(GB)?(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/.test(clean);
  if (EU.includes(country)) return new RegExp(`^(${country === 'GR' ? 'EL' : country})?[0-9A-Z]{8,12}$`).test(clean);
  return /^[0-9A-Z]{4,20}$/.test(clean);
}

const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
const countryName = (code: string) => COUNTRIES.find((item) => item.value === code)?.label ?? code;

export function BusinessDetailsForm({ initial, onSave, submitLabel, working, disabled, onDraft }: {
  initial?: Partial<BusinessDetails>;
  onSave: (details: BusinessDetails) => Promise<void>;
  submitLabel: string;
  working?: string;
  disabled?: string | null;
  onDraft?: (details: Partial<BusinessDetails>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [country, setCountry] = useState(initial?.country && COUNTRIES.some((item) => item.value === initial.country) ? initial.country : 'GB');
  const [email, setEmail] = useState(initial?.billing_email ?? '');
  const [vat, setVat] = useState(initial?.vat_number ?? '');
  const [po, setPo] = useState(initial?.po_number ?? '');
  const [errors, setErrors] = useState<{ name?: string; email?: string; vat?: string }>({});
  const off = Boolean(disabled);

  const draftRef = useRef(onDraft);
  draftRef.current = onDraft;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    draftRef.current?.({ name, country, billing_email: email, vat_number: vat, po_number: po });
  }, [name, country, email, vat, po]);

  const submit = async () => {
    const next = {
      name: name.trim() ? undefined : BUSINESS_COPY.needOrgName,
      email: looksLikeEmail(email) ? undefined : BUSINESS_COPY.needEmail,
      vat: vatLooksRight(country, vat) ? undefined : BUSINESS_COPY.badVat(countryName(country)),
    };
    setErrors(next);
    if (next.name || next.email || next.vat) return;
    await onSave({ name: name.trim(), country, billing_email: email.trim(), vat_number: vat.trim() || undefined, po_number: po.trim() || undefined });
  };

  return <form className="bzf-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
    <TextField label={BUSINESS_COPY.orgName} value={name} onChange={setName} required disabled={off} error={errors.name} />
    <Select label={BUSINESS_COPY.country} value={country} onChange={setCountry} disabled={off} options={COUNTRIES} />
    <TextField label={BUSINESS_COPY.billingEmail} type="email" value={email} onChange={setEmail} required disabled={off} error={errors.email} />
    <TextField label={BUSINESS_COPY.vat} help={BUSINESS_COPY.vatHelp} value={vat} onChange={setVat} disabled={off} error={errors.vat} />
    <TextField label={BUSINESS_COPY.po} help={BUSINESS_COPY.poHelp} value={po} onChange={setPo} disabled={off} />
    {disabled && <p className="biz-quiet">{disabled}</p>}
    <div className="biz-row"><Action type="button" className="primary" run={submit} disabled={off} working={working}>{submitLabel}</Action></div>
  </form>;
}
