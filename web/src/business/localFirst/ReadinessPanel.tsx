import { useMemo, useState } from 'react';
import type { Venue, Zone } from '../types';
import {
  inspectFleet, inspectVenue, inspectZone, localFirstOn, READINESS_ORDER, READINESS_WORDS,
  type ReadinessState, type Recovery,
} from './readiness';
import './readiness.css';

const timeWords = (at: number | null) => at == null ? 'Never verified' : new Date(at * 1000).toLocaleString();
const numberWords = (value: number | null, unit = '') => value == null || !Number.isFinite(value) ? 'Unverified' : String(value) + unit;
const canShow = (value: number | null) => value != null && Number.isFinite(value) && value >= 0;
const stateClass = (state: ReadinessState) => 'lf13-state lf13-state-' + state;

function StateWord({ state }: { state: ReadinessState }) {
  return <strong className={stateClass(state)} data-readiness={state}>{READINESS_WORDS[state]}</strong>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="lf13-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}

export function HqLocalReadiness({ venues, now, offline, onOpenVenue }: {
  venues: Venue[]; now: number; offline: boolean; onOpenVenue: (id: string) => void;
}) {
  const fleet = useMemo(() => inspectFleet(venues, now, offline), [venues, now, offline]);
  const ordered = useMemo(() => [...fleet.venues].sort((a, b) =>
    READINESS_ORDER.indexOf(a.state) - READINESS_ORDER.indexOf(b.state) || a.venueName.localeCompare(b.venueName)), [fleet]);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? ordered : ordered.slice(0, 20);
  return <section className="biz-card lf13-hq" aria-labelledby="lf13-hq-title" data-testid="lf13-hq">
    <div className="biz-row lf13-hq-head">
      <div><h2 id="lf13-hq-title">Local engine readiness</h2>
        <p className="biz-quiet">Verified local music, actual speakers and offline fallback across your venues</p></div>
      <span role="status">{fleet.ready} of {venues.length} venues activation-ready</span>
    </div>
    {offline && <p role="status">HQ is disconnected. These are last-known reports, not confirmation that a speaker is playing now. Local engines may continue.</p>}
    <dl className="lf13-counts">
      {(['healthy', 'degraded', 'silent', 'offline', 'unknown'] as ReadinessState[]).map((state) =>
        <div key={state}><dt>{READINESS_WORDS[state]}</dt><dd>{fleet.counts[state]}</dd></div>)}
    </dl>
    <ul className="lf13-venue-list">
      {shown.map((item) => <li key={item.venueId} data-venue-readiness={item.state}>
        <div><b>{item.venueName}</b><span className="biz-quiet">{item.zones.length} zones · {item.zones.filter((zone) => zone.issues.length).length} needing attention</span></div>
        <StateWord state={item.state} />
        <button type="button" onClick={() => onOpenVenue(item.venueId)} aria-label={'Review ' + item.venueName + ' readiness'}>Review venue</button>
      </li>)}
    </ul>
    {ordered.length > 20 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Show first 20 venues' : 'Show all ' + ordered.length + ' venues'}
    </button>}
    {!venues.length && <p>No venues have been set up.</p>}
  </section>;
}

function RecoveryList({ issues, onOpenTab }: {
  issues: Recovery[]; onOpenTab: (tab: Recovery['tab']) => void;
}) {
  if (!issues.length) return <p className="biz-quiet">All required local checks have current confirmation.</p>;
  return <ul className="lf13-recovery">
    {issues.map((issue) => <li key={`${issue.kind}:${issue.title}`}>
      <div><strong>{issue.title}</strong><p>{issue.action}</p></div>
      <button type="button" onClick={() => onOpenTab(issue.tab)} aria-label={'Open ' + issue.tab + ' for ' + issue.title}>Open {issue.tab}</button>
    </li>)}
  </ul>;
}

/** Manager-only diagnostics. No request here can restart, test or take over a real engine: the
 * local engine must verify those actions, and overview refresh only rereads its evidence. */
export function VenueLocalReadiness({ venue, now, offline, onOpenTab, onRefresh }: {
  venue: Venue; now: number; offline: boolean;
  onOpenTab: (tab: Recovery['tab']) => void; onRefresh: () => void | Promise<void>;
}) {
  const details = inspectVenue(venue, now, offline);
  const [rechecking, setRechecking] = useState(false);
  return <section className="biz-card lf13-detail" aria-labelledby={'lf13-' + venue.id}>
    <div className="biz-row">
      <div><h2 id={'lf13-' + venue.id}>Local playback readiness</h2><p className="biz-quiet">Each zone needs its own authorised music and real speaker test.</p></div>
      <StateWord state={details.state} />
    </div>
    {!details.activationReady && <p role="status">This venue is not verified for activation. Confirm all checks on the local engine before starting service.</p>}
    {offline && <p role="status">Internet is unavailable. Existing local playback may continue, but HQ cannot verify or transfer it. Check on site.</p>}
    <div className="lf13-zones">
      {details.zones.map((item) => <article key={item.zoneId} className="lf13-zone" data-zone-readiness={item.state}>
        <div className="biz-row"><h3>{item.zoneName}</h3><StateWord state={item.state} /></div>
        <dl className="lf13-facts">
          <Fact label="Verified music" value={canShow(item.verified) && canShow(item.required) ? String(item.verified) + ' / ' + String(item.required) : 'Unverified'} />
          <Fact label="Prepared horizon" value={numberWords(item.preparedMinutes, ' min')} />
          <Fact label="Committed / planned" value={numberWords(item.committedMinutes, ' min') + ' / ' + numberWords(item.plannedMinutes, ' min')} />
          <Fact label="Fallback" value={numberWords(item.fallbackMinutes, ' min')} />
          <Fact label="Real speaker" value={item.speaker ?? 'Not confirmed'} />
          <Fact label="Actual output" value={item.output ?? 'Unknown'} />
          <Fact label="Ownership generation" value={numberWords(item.generation)} />
          <Fact label="Last verified" value={timeWords(item.verifiedAt)} />
        </dl>
        <RecoveryList issues={item.issues} onOpenTab={onOpenTab} />
      </article>)}
    </div>
    {details.zones.length === 0 && <p>No zones yet. Add a zone and pair a local engine.</p>}
    <div className="biz-row">
      <button type="button" disabled={rechecking} onClick={() => {
        setRechecking(true);
        void Promise.resolve(onRefresh()).finally(() => setRechecking(false));
      }}>{rechecking ? 'Checking reports…' : 'Refresh verified reports'}</button>
      <p className="biz-quiet">Refreshing does not test speakers or start music.</p>
    </div>
  </section>;
}

export function LocalSetupGuide({ venue, now, offline, stage, onOpenTab, onRefresh }: {
  venue: Venue; now: number; offline: boolean; stage: 'music' | 'pair' | 'service';
  onOpenTab: (tab: Recovery['tab']) => void; onRefresh: () => void | Promise<void>;
}) {
  return <div className="biz-stack lf13-setup" data-setup-stage={stage}>
    <p>{stage === 'music'
      ? 'Connect authorised music folders or drives on the venue computer. Selecta Cloud stores the catalogue and controls, not the audio.'
      : stage === 'pair'
        ? 'Install and pair the local engine for each zone. Test the selected physical speaker output; a tablet or unlocked browser is not a speaker.'
        : 'Before service: confirm approved music rules, prepared transitions, offline fallback and an on-site internet-disconnect rehearsal.'}</p>
    <VenueLocalReadiness venue={venue} now={now} offline={offline} onOpenTab={onOpenTab} onRefresh={onRefresh} />
  </div>;
}

/** Keep staff messages small and free of technical diagnostics and management information. */
export function StaffSpeakerLine({ venue, zone, now, offline }: { venue: Venue; zone: Zone; now: number; offline: boolean }) {
  const info = inspectZone(zone, venue, now, offline);
  const words: Record<ReadinessState, string> = {
    healthy: 'Speaker confirmed',
    degraded: 'Speaker needs a manager check',
    silent: 'No sound confirmed. Ask a manager to check the speaker.',
    offline: 'Venue is offline. The last report showed local music playing.',
    unknown: 'Speaker status not verified. Ask a manager before assuming music is playing.',
  };
  return <p className="lf13-staff-line" role="status" data-speaker-status={info.state}>{words[info.state]}</p>;
}

export { localFirstOn };
