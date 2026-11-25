import { accountFlagOn, type FlagId } from '../flags';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { PhaseName, Phases } from '../lucy/types';
import { PHASES } from './LucySettings';
import '../styles/lucy.css';
import { Badge, Notice, SettingsCard } from '../cloud/AccountLayout';
import { Action, Skeleton } from '../ui/controls';
import { userLocale } from '../ui/format';
import { Meter } from '../ui/Meter';
import { LUCY_USAGE_EVENT, windowsOf, type LucyWindows } from '../cloud/lucyUsage';
import { LucyUsageMeter } from './LucyUsageMeter';

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
  /** ADR-0484: the one usage read model. Absent from a server that still counts turns. */
  usage_windows?: (LucyWindows & { estimated_messages?: number | null }) | null;
  usage_cutover?: { at: number; time_zone: string };
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** A failure in words a person can use: a server's bare "Internal Server Error" (or no words at
 * all) said nothing, so it is said plainly; a reason the server gave on purpose is kept. */
export function plainProblem(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || /^(internal server error|bad gateway|service unavailable|gateway timeout|not found)\.?$/i.test(message)) {
    return 'SelectaDJ couldn’t do that just now. Try again in a moment.';
  }
  return message;
}

function resetDate(epoch: number | null) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleDateString(userLocale(), { day: 'numeric', month: 'short' });
}

export function LucyTurnsMeter({ usage }: { usage: CloudLucy['usage'] }) {
  const words = usage.limit === null ? `${usage.used} turns this month` : `${usage.used} of ${usage.limit} turns this month`;
  const percent = usage.limit ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  return (
    <div className="lucy-cloud-meter">
      <p><b>{words}</b>{usage.resets_at ? <span className="soft"> · resets {resetDate(usage.resets_at)}</span> : null}</p>
      {usage.limit !== null && <Meter kind="meter" label="Lucy turns this month" showLabel={false} value={Math.round(percent)} max={100} valueText={words} warnAt={0.8} dangerAt={1} />}
      {/* the meter turning red is not words: say what a full meter means, and when it ends */}
      {usage.limit !== null && usage.used >= usage.limit && (
        <p className="lucy-cloud-spent" role="note">
          {usage.fair_use
            ? 'You’ve used this month’s planning turns. Quick turns still work.'
            : 'You’ve used all of this month’s turns, so Lucy can’t take a new request yet.'}
          {usage.resets_at ? ` They start again on ${resetDate(usage.resets_at)}.` : ''}
        </p>
      )}
      {usage.fair_use && <p className="hint">Quick turns on your plan are fair use: counted, never cut off.</p>}
    </div>
  );
}

/** Said on `window` when the server says a Lucy turn was settled (CloudApp's event stream). */
export const LUCY_TURNS_EVENT = 'selecta:lucy-turns';

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
  const live = useRef(true);
  const load = useCallback(async (retried = false) => {
    setProblem('');
    try {
      const next = await asked.current<CloudLucy>('/account/lucy');
      if (!live.current) return;
      setStatus(next); setEnabled(next.enabled); setPhases(next.phases); setPrivacy(next.privacy);
      // Try again goes away once the settings are here, and the keyboard's focus went with it to
      // the top of the page: it lands on the card's title instead
      if (retried) window.requestAnimationFrame(() => {
        const title = document.getElementById('lucy-cloud-title');
        if (!title || document.activeElement !== document.body) return;
        title.tabIndex = -1;
        title.focus();
      });
    } catch (error) {
      if (live.current) setProblem(plainProblem(error));
      return false; // said here, so Try again draws no tick
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; };
  }, [load]);
  // ADR-0476 item 31: a turn settled on any device; only the meter is read again, so choices
  // ticked here but not saved yet stay as they are
  useEffect(() => {
    const again = () => {
      void asked.current<CloudLucy>('/account/lucy')
        .then((next) => { if (live.current) setStatus((was) => (was ? { ...was, usage: next.usage, usage_windows: next.usage_windows, usage_cutover: next.usage_cutover } : was)); })
        .catch(() => {});
    };
    window.addEventListener(LUCY_TURNS_EVENT, again);
    window.addEventListener(LUCY_USAGE_EVENT, again);
    return () => {
      window.removeEventListener(LUCY_TURNS_EVENT, again);
      window.removeEventListener(LUCY_USAGE_EVENT, again);
    };
  }, []);

  if (!status || !phases) {
    return (
      <SettingsCard id="lucy-cloud" className="lucy-settings" title="Lucy" about="Whether to use Lucy, and what it may share." busy={!problem}>
        {problem
          // a way on from here: without it the only way to try again was to reload the page
          ? <Notice tone="danger" role="alert" action={<Action run={() => load(true)} working="Trying again…">Try again</Action>}><strong>Lucy’s settings could not be loaded.</strong> <span>{problem}</span></Notice>
          : <Skeleton variant="rows" lines={3} label="Loading Lucy’s settings" />}
      </SettingsCard>
    );
  }

  // the new meter only when the server sends its figures, never from a flag alone (ADR-0484)
  const windows = windowsOf(status.usage_windows);
  const estimate = status.usage_windows?.estimated_messages;
  const showEstimate = windows && typeof estimate === 'number' && Number.isSafeInteger(estimate) && estimate >= 0;
  const shown = PHASES.filter((phase) => ([] as FlagId[]).concat(phase.flag ?? []).every((flag) => accountFlagOn(flag, features)));
  const changed = enabled !== status.enabled || JSON.stringify(phases) !== JSON.stringify(status.phases)
    || privacy.share_lyrics !== status.privacy.share_lyrics || privacy.share_history !== status.privacy.share_history;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    // the button stays focusable while it can't be pressed (below), so the press is refused here
    if (saving || !changed) return;
    setSaving(true); setProblem(''); setSaved('');
    try {
      const next = await request<CloudLucy>('/account/lucy', { method: 'PUT', body: JSON.stringify({ enabled, phases, privacy }) });
      setStatus(next); setEnabled(next.enabled); setPhases(next.phases); setPrivacy(next.privacy);
      // said once, in the line beside the button (a toast as well was the same news twice)
      setSaved('Saved.');
    } catch (error) { setProblem(plainProblem(error)); }
    finally { setSaving(false); }
  };

  return (
    <SettingsCard
      id="lucy-cloud"
      className="lucy-settings"
      title="Lucy on your plan"
      badge={<Badge>{status.tier}</Badge>}
      about="Your plan sets how much Lucy can do. You choose whether to use it and what it may share."
    >
      {windows ? <LucyUsageMeter windows={windows} /> : <LucyTurnsMeter usage={status.usage} />}
      {status.usage_cutover && (
        <Notice role="note">
          Starting {new Date(status.usage_cutover.at * 1000).toLocaleDateString(userLocale(), {
            dateStyle: 'long', timeZone: status.usage_cutover.time_zone,
          })}, Lucy will use a session and weekly allowance in place of monthly turns. You’ll be able to see how much usage remains. Your plan price stays the same.
        </Notice>
      )}
      {showEstimate && (
        <p className="hint">About {estimate} more {estimate === 1 ? 'message' : 'messages'} like your recent ones.</p>
      )}
      <form onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>Use</legend>
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
          <p className="hint">These choices send text to SelectaDJ’s AI provider when Lucy works on a request. Audio is never sent.</p>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_lyrics} onChange={(event) => setPrivacy({ ...privacy, share_lyrics: event.target.checked })} />
            <span><b>Share short lyric snippets</b> <span className="soft">when it helps match words between songs.</span></span>
          </label>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_history} onChange={(event) => setPrivacy({ ...privacy, share_history: event.target.checked })} />
            <span><b>Share a summary of your listening</b> <span className="soft">most played and most skipped, never a full log.</span></span>
          </label>
        </fieldset>
        {problem && <Notice tone="danger" role="alert"><strong>Your changes were not saved.</strong> <span>{problem}</span></Notice>}
        <div className="row wrap lucy-cloud-save">
          {/* aria-disabled, never disabled: a disabled button drops the keyboard's focus to the top
              of the page the moment a save starts or ends */}
          <button type="submit" className={changed ? 'primary' : undefined} aria-disabled={saving || !changed || undefined} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save changes'}</button>
          <span className="hint" role="status">{saving ? '' : changed ? 'You have changes that are not saved yet.' : saved ? 'All changes saved.' : ''}</span>
        </div>
      </form>
    </SettingsCard>
  );
}
