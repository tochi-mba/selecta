import { FormEvent, useEffect, useRef, useState } from 'react';
import type { PhaseName, Phases } from '../lucy/types';
import { PHASES } from './LucySettings';
import '../styles/lucy.css';

/** Lucy's settings in Cloud mode (docs/saas/09-lucy-ai-gateway.md §9.5). Only the person's own
 * choices are here: Use Lucy, the phases, and what may be shared with Selecta's AI provider. The
 * provider, model, address, key, limits and spending cap belong to the server in Cloud, so they
 * aren't shown at all; the plan's Lucy level and this month's turns are shown instead. Local mode
 * keeps using `LucySettings`, unchanged. */

export type CloudLucy = {
  enabled: boolean;
  phases: Phases;
  privacy: { share_lyrics: boolean; share_history: boolean };
  tier: string;
  usage: { used: number; limit: number | null; fair_use: boolean; resets_at: number | null };
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

function resetDate(epoch: number | null) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function LucyTurnsMeter({ usage }: { usage: CloudLucy['usage'] }) {
  const words = usage.limit === null ? `${usage.used} turns this month` : `${usage.used} of ${usage.limit} turns this month`;
  const percent = usage.limit ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  return (
    <div className="lucy-cloud-meter">
      <p><b>{words}</b>{usage.resets_at ? <span className="soft"> · resets {resetDate(usage.resets_at)}</span> : null}</p>
      {usage.limit !== null && <div className="cloud-meter" role="progressbar" aria-label="Lucy turns this month" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={words}><i style={{ width: `${percent}%` }} /></div>}
      {usage.fair_use && <p className="hint">Quick turns on your plan are fair use: counted, never cut off.</p>}
    </div>
  );
}

export function LucyCloudSettings({ request, features = {} }: { request: Request; features?: Record<string, boolean> }) {
  const [status, setStatus] = useState<CloudLucy | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [phases, setPhases] = useState<Phases | null>(null);
  const [privacy, setPrivacy] = useState({ share_lyrics: false, share_history: false });
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  // Read once per mount: a parent that hands over a new `request` on each render mustn't throw
  // away what the person has ticked but not saved yet.
  const asked = useRef(request);
  asked.current = request;
  useEffect(() => {
    let live = true;
    asked.current<CloudLucy>('/account/lucy').then((next) => {
      if (!live) return;
      setStatus(next); setEnabled(next.enabled); setPhases(next.phases); setPrivacy(next.privacy);
    }).catch((error: Error) => { if (live) setProblem(error.message); });
    return () => { live = false; };
  }, []);

  if (!status || !phases) return <section className="cloud-card lucy-settings" aria-busy={!problem || undefined}><h2>Lucy</h2>{problem ? <p className="warn" role="alert">{problem}</p> : <p>Loading Lucy’s settings…</p>}</section>;

  const shown = PHASES.filter((phase) => ([] as string[]).concat(phase.flag ?? []).every((flag) => features[flag] !== false));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setProblem(''); setSaved('');
    try {
      const next = await request<CloudLucy>('/account/lucy', { method: 'PUT', body: JSON.stringify({ enabled, phases, privacy }) });
      setStatus(next);
      setSaved('Saved.');
    } catch (error) { setProblem((error as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <section className="cloud-card lucy-settings" aria-labelledby="lucy-cloud-title">
      <p className="cloud-eyebrow">LUCY</p>
      <h2 id="lucy-cloud-title">{status.tier}</h2>
      <p className="hint">Your plan sets which AI model Lucy uses and how much each request may do. You choose whether to use Lucy and what it may share.</p>
      <LucyTurnsMeter usage={status.usage} />
      <form onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>Lucy</legend>
          <label className="choice"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Use Lucy</label>
          <p className="hint">Turning Lucy off never changes your mixes or your music.</p>
          {shown.map((phase) => (
            <label key={phase.name} className="choice lucy-setting-line">
              <input type="checkbox" checked={phases[phase.name as PhaseName]} disabled={!enabled} onChange={(event) => setPhases({ ...phases, [phase.name]: event.target.checked })} />
              <span><b>{phase.label}</b> <span className="soft">{phase.about}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Privacy</legend>
          <p className="hint">These choices send text to Selecta’s AI provider when Lucy works on a request. Audio is never sent.</p>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_lyrics} onChange={(event) => setPrivacy({ ...privacy, share_lyrics: event.target.checked })} />
            <span><b>Share short lyric snippets</b> <span className="soft">when it helps match words between songs.</span></span>
          </label>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_history} onChange={(event) => setPrivacy({ ...privacy, share_history: event.target.checked })} />
            <span><b>Share a summary of your listening</b> <span className="soft">most played and most skipped, never a full log.</span></span>
          </label>
        </fieldset>
        {problem && <p className="warn" role="alert">{problem}</p>}
        <div className="row wrap">
          <button type="submit" className="primary" disabled={saving} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save Lucy settings'}</button>
          {saved && <span className="hint" role="status">{saved}</span>}
        </div>
      </form>
    </section>
  );
}
