import { FormEvent, useCallback, useEffect, useState } from 'react';
import './autopilot.css';

// Guided venue setup (ADR-0425, AV-0425-02). Shown in Cloud Settings only while the account has
// `autopilot.venue_policy`; the server refuses every route with the flag off, so nothing here can
// run without it. Each step is saved on its own and checked by the server, which says which
// field is wrong. Publishing makes a new, numbered policy version; older versions stay listed.

export type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;

type StepInfo = { id: string; title: string; help: string; required: boolean; done: boolean };
export type SetupState = {
  venue_id: string;
  steps: StepInfo[];
  saved: Record<string, Record<string, unknown>>;
  next_step: string | null;
  ready: boolean;
  missing: string[];
};
type PolicyVersion = { version: number; effective_from: string; name: string };
export type Policies = { venue_id: string; effective: PolicyVersion | null; history: PolicyVersion[] };

type Fields = Record<string, string | boolean>;

function initialFields(step: string, saved: Record<string, unknown> | undefined): Fields {
  const s = saved ?? {};
  const list = (key: string) => (Array.isArray(s[key]) ? (s[key] as string[]).join(', ') : '');
  const num = (key: string) => (s[key] === null || s[key] === undefined ? '' : String(s[key]));
  switch (step) {
    case 'venue': return { name: String(s.name ?? ''), timezone: String(s.timezone ?? 'Europe/London') };
    case 'sources': return { licensed_sources: list('licensed_sources'), confirm_licensed: Boolean(s.confirm_licensed) };
    case 'content': return { allow_explicit: Boolean(s.allow_explicit), banned_artists: list('banned_artists'), banned_genres: list('banned_genres') };
    case 'limits': return { bpm_max: num('bpm_max'), energy_max: num('energy_max'), volume_cap: num('volume_cap') };
    case 'dayparts': {
      const first = Array.isArray(s.dayparts) ? (s.dayparts[0] as Record<string, unknown> | undefined) : undefined;
      const limits = (first?.limits ?? {}) as Record<string, unknown>;
      return { name: String(first?.name ?? ''), start: String(first?.start ?? ''), end: String(first?.end ?? ''), energy_max: limits.energy_max == null ? '' : String(limits.energy_max) };
    }
    case 'closing': return { closing_behaviour: String(s.closing_behaviour ?? 'wind_down') };
    default: return { confirmed: Boolean(s.confirmed) };
  }
}

const split = (value: string | boolean) => String(value).split(',').map((v) => v.trim()).filter(Boolean);
const numberOrNull = (value: string | boolean) => (String(value).trim() === '' ? null : Number(value));

export function stepBody(step: string, f: Fields): Record<string, unknown> {
  switch (step) {
    case 'sources': return { licensed_sources: split(f.licensed_sources), confirm_licensed: f.confirm_licensed === true };
    case 'content': return { allow_explicit: f.allow_explicit === true, banned_artists: split(f.banned_artists), banned_genres: split(f.banned_genres) };
    case 'limits': return { bpm_max: numberOrNull(f.bpm_max), energy_max: numberOrNull(f.energy_max), volume_cap: numberOrNull(f.volume_cap) };
    case 'dayparts': return String(f.name).trim() === '' ? { dayparts: [] } : { dayparts: [{ name: f.name, start: f.start, end: f.end, limits: { energy_max: numberOrNull(f.energy_max) } }] };
    case 'review': return { confirmed: f.confirmed === true };
    default: return { ...f };
  }
}

function errorText(problem: unknown): string {
  // Cloud's `api` throws a CloudError carrying the refusal body as `payload`.
  type Detail = { errors?: Record<string, string>; message?: string };
  const body = (problem as { payload?: { detail?: Detail } })?.payload;
  const detail = body?.detail ?? (problem as { detail?: Detail })?.detail;
  if (detail?.errors) return Object.values(detail.errors).join(' ');
  return detail?.message ?? (problem as Error)?.message ?? 'That did not save.';
}

export function VenueSetup({ api, workspaceId, venueId = 'main' }: { api: Api; workspaceId: string; venueId?: string }) {
  const base = `/autopilot/venues/${encodeURIComponent(venueId)}`;
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [step, setStep] = useState('venue');
  const [fields, setFields] = useState<Fields>(() => initialFields('venue', undefined));
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');

  const load = useCallback(async () => {
    try {
      const [loaded, versions] = await Promise.all([
        api<SetupState>(`${base}/setup`, {}, workspaceId),
        api<Policies>(`${base}/policies`, {}, workspaceId),
      ]);
      setSetup(loaded); setPolicies(versions); setError('');
      const first = loaded.next_step ?? 'review';
      setStep(first); setFields(initialFields(first, loaded.saved[first]));
    } catch (problem) { setError(errorText(problem)); }
  }, [api, base, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const choose = (id: string) => { setStep(id); setFields(initialFields(id, setup?.saved[id])); setError(''); setSaid(''); };
  const set = (key: string, value: string | boolean) => setFields((old) => ({ ...old, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = await api<SetupState>(`${base}/setup/${step}`, { method: 'PUT', body: JSON.stringify(stepBody(step, fields)) }, workspaceId);
      setSetup(next); setError(''); setSaid('Saved.');
      const following = next.next_step ?? 'review';
      setStep(following); setFields(initialFields(following, next.saved[following]));
    } catch (problem) { setError(errorText(problem)); setSaid(''); }
  };
  const publish = async () => {
    try {
      const done = await api<Policies & { published: PolicyVersion }>(`${base}/policies`, { method: 'POST', body: '{}' }, workspaceId);
      setPolicies(done); setError(''); setSaid(`Published version ${done.published.version}.`);
    } catch (problem) { setError(errorText(problem)); }
  };

  const text = (key: string, label: string, extra: Record<string, string> = {}) => (
    <label className="venue-setup-field">{label}<input name={key} value={String(fields[key] ?? '')} onChange={(e) => set(key, e.target.value)} {...extra} /></label>
  );
  const check = (key: string, label: string) => (
    <label className="venue-setup-check"><input type="checkbox" name={key} checked={fields[key] === true} onChange={(e) => set(key, e.target.checked)} />{label}</label>
  );
  const current = setup?.steps.find((s) => s.id === step);

  return (
    <section className="venue-setup" aria-labelledby="venue-setup-title">
      <h2 id="venue-setup-title">Venue setup</h2>
      <p className="venue-setup-help">Set what SelectaDJ may play at this venue. Every change you publish becomes a new version, and older versions stay in the history.</p>
      {setup && (
        <ol className="venue-setup-steps">
          {setup.steps.map((s) => (
            <li key={s.id}><button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => choose(s.id)}>{s.title}{s.done ? ' (done)' : s.required ? ' (needed)' : ''}</button></li>
          ))}
        </ol>
      )}
      {current && (
        <form className="venue-setup-form" onSubmit={save} aria-label={current.title}>
          <h3>{current.title}</h3>
          <p className="venue-setup-help">{current.help}</p>
          {step === 'venue' && <>{text('name', 'Venue name')}{text('timezone', 'Time zone')}</>}
          {step === 'sources' && <>{text('licensed_sources', 'Licensed sources, separated by commas')}{check('confirm_licensed', 'This venue holds a licence for these sources')}</>}
          {step === 'content' && <>{check('allow_explicit', 'Allow explicit lyrics')}{text('banned_artists', 'Never play these artists')}{text('banned_genres', 'Never play these genres')}</>}
          {step === 'limits' && <>{text('bpm_max', 'Highest BPM', { inputMode: 'decimal' })}{text('energy_max', 'Highest energy, 0 to 1', { inputMode: 'decimal' })}{text('volume_cap', 'Volume cap, 0 to 1', { inputMode: 'decimal' })}</>}
          {step === 'dayparts' && <>{text('name', 'Daypart name, or leave empty for none')}{text('start', 'Starts (HH:MM)')}{text('end', 'Ends (HH:MM)')}{text('energy_max', 'Highest energy in this daypart', { inputMode: 'decimal' })}</>}
          {step === 'closing' && (
            <label className="venue-setup-field">How the night ends
              <select name="closing_behaviour" value={String(fields.closing_behaviour)} onChange={(e) => set('closing_behaviour', e.target.value)}>
                <option value="wind_down">Wind down</option>
                <option value="fade_out">Fade out</option>
                <option value="stop_at_close">Stop at close</option>
              </select>
            </label>
          )}
          {step === 'review' && check('confirmed', 'The settings above are right')}
          <div className="venue-setup-actions"><button type="submit">Save</button></div>
        </form>
      )}
      {setup && step === 'review' && (
        <div className="venue-setup-actions">
          <button type="button" onClick={() => void publish()} disabled={!setup.ready || !setup.saved.review}>Publish policy</button>
          {!setup.ready && <span className="venue-setup-help">Finish: {setup.missing.join(', ')}</span>}
        </div>
      )}
      {policies && (
        <p className="venue-setup-version">{policies.effective ? `In force: version ${policies.effective.version} of ${policies.history.length}.` : 'No policy published yet.'}</p>
      )}
      <p className="venue-setup-said" role="status">{said}</p>
      {error && <p className="venue-setup-error" role="alert">{error}</p>}
    </section>
  );
}
