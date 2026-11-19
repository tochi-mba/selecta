// `/business/start` (ADR-0453 D6, S1 entry). CloudApp opens it only with `business.start` on.
// While `business.signups` is off (the default) it is the private-pilot contact form, which
// emails REX Technologies; nothing is created. With sign-up on it names a new organisation
// through `POST /api/business/orgs` and opens its setup checklist. The card and the trial
// itself are on the organisation's Billing page (ADR-0447), never asked for here.

import { FormEvent, useState } from 'react';
import type { Api } from '../../cloud/api';
import { PATHS } from '../context';
import '../business.css';

export const START_COPY = {
  title: 'SelectaDJ for Business',
  pilotLead: 'SelectaDJ for Business is in private pilot. Tell us about your venue and REX Technologies will be in touch.',
  businessName: 'Business name',
  venues: 'How many venues?',
  city: 'Town or city (optional)',
  message: 'Anything else (optional)',
  send: 'Send',
  sending: 'Sending',
  sent: 'Thanks. REX Technologies will reply to your SelectaDJ email address.',
  signupLead: 'Name your organisation to start. You can add venues, hours and music next.',
  create: 'Create organisation',
  creating: 'Creating',
} as const;

function problemWords(problem: unknown, fallback: string) {
  const message = (problem as { message?: string })?.message;
  return message && !message.startsWith('Request failed') ? message : fallback;
}

export default function StartPage({ api, signups, onOpen }: { api: Api; signups: boolean; onOpen: (path: string) => void }) {
  const [name, setName] = useState('');
  const [venues, setVenues] = useState(1);
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || working) return;
    setWorking(true); setError('');
    try {
      if (signups) {
        const made = await api<{ org: { id: string } }>('/business/orgs', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        onOpen(PATHS.setup(made.org.id));
      } else {
        await api('/business/pilot-interest', { method: 'POST', body: JSON.stringify({ business_name: name.trim(), venues, city: city.trim(), message: message.trim() }) });
        setSent(true);
      }
    } catch (problem) {
      setError(problemWords(problem, "That didn't go through. Try again."));
    } finally { setWorking(false); }
  };

  return (
    <main className="biz biz-runtime biz-stack">
      <h1>{START_COPY.title}</h1>
      <p>{signups ? START_COPY.signupLead : START_COPY.pilotLead}</p>
      {sent ? <p role="status">{START_COPY.sent}</p> : (
        <form className="biz-card biz-stack" onSubmit={(event) => void submit(event)}>
          <label>{START_COPY.businessName} <input value={name} required maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
          {!signups && <>
            <label>{START_COPY.venues} <input type="number" min={1} max={10000} value={venues} onChange={(event) => setVenues(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>{START_COPY.city} <input value={city} maxLength={120} onChange={(event) => setCity(event.target.value)} /></label>
            <label>{START_COPY.message} <textarea value={message} maxLength={2000} onChange={(event) => setMessage(event.target.value)} /></label>
          </>}
          <button type="submit" disabled={working}>{working ? (signups ? START_COPY.creating : START_COPY.sending) : (signups ? START_COPY.create : START_COPY.send)}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
