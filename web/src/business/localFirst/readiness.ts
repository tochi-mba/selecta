// Agent 13: presentation-only adapter for Agent 09's local venue telemetry.
// No audio paths, fingerprints or engine commands cross this boundary.
// A missing or stale report is UNKNOWN, never healthy.
import type { Venue, Zone } from '../types';

export type ReadinessState = 'healthy' | 'degraded' | 'silent' | 'offline' | 'unknown';
export type EngineState = 'ready' | 'starting' | 'stopped' | 'crashed' | 'offline_playing' | 'unknown';
export type SourceState = 'connected' | 'disconnected' | 'permission_required' | 'missing' | 'unknown';
export type OutputState = 'playing' | 'idle' | 'failed' | 'silent' | 'untested' | 'unknown';

export type LocalZoneReport = {
  /** Server-supplied, epoch seconds; not the time the browser fetched the overview. */
  verified_at: number | null;
  engine: { state: EngineState; version?: string; update_required?: boolean };
  source: { state: SourceState };
  inventory: { verified: number; required: number };
  horizon: { committed_minutes: number; prepared_minutes: number; planned_minutes: number; fallback_minutes: number };
  output: {
    state: OutputState;
    /** A browser AudioContext unlock is never output verification. */
    physical_verified: boolean;
    device_name?: string;
    generation?: number;
  };
  policy_approved?: boolean;
  offline_rehearsed?: boolean;
};

export type RecoveryKind =
  | 'engine' | 'source' | 'media' | 'output' | 'fallback' | 'update' | 'policy' | 'rehearsal' | 'verify';

export type Recovery = {
  kind: RecoveryKind;
  title: string;
  action: string;
  tab: 'devices' | 'rules' | 'schedule' | 'licence';
};

export type ZoneReadiness = {
  zoneId: string;
  zoneName: string;
  state: ReadinessState;
  /** Last actual engine verification time, not last HTTP read time. */
  verifiedAt: number | null;
  verified: number | null;
  required: number | null;
  committedMinutes: number | null;
  preparedMinutes: number | null;
  plannedMinutes: number | null;
  fallbackMinutes: number | null;
  speaker: string | null;
  generation: number | null;
  output: OutputState | null;
  issues: Recovery[];
  /** Activation requires all gates, including a real physical output and offline rehearsal. */
  activationReady: boolean;
};

export const MIN_PREPARED_MINUTES = 15;
export const MIN_FALLBACK_MINUTES = 30;
export const TELEMETRY_STALE_SECONDS = 120;

const recovery = (kind: RecoveryKind, title: string, action: string, tab: Recovery['tab']): Recovery =>
  ({ kind, title, action, tab });

export function localFirstOn(features: Record<string, boolean> | undefined | null): boolean {
  return features?.['business.local_first'] === true;
}

function verifiedAt(report: LocalZoneReport | undefined): number | null {
  const at = report?.verified_at;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

/** Converts the overview projection into UI-only evidence; does not infer safety from songs or connectivity. */
export function inspectZone(zone: Zone, venue: Venue, now: number, browserOffline = false): ZoneReadiness {
  const report = zone.local_first;
  const at = verifiedAt(report);
  const base: ZoneReadiness = {
    zoneId: zone.id, zoneName: zone.name, state: 'unknown', verifiedAt: at,
    verified: report?.inventory.verified ?? null, required: report?.inventory.required ?? null,
    committedMinutes: report?.horizon.committed_minutes ?? null,
    preparedMinutes: report?.horizon.prepared_minutes ?? null,
    plannedMinutes: report?.horizon.planned_minutes ?? null,
    fallbackMinutes: report?.horizon.fallback_minutes ?? null,
    speaker: report?.output.device_name ?? null,
    generation: report?.output.generation ?? null, output: report?.output.state ?? null,
    issues: [], activationReady: false,
  };
  if (!report || at == null || at > now + 30 || now - at > TELEMETRY_STALE_SECONDS) {
    base.issues.push(recovery('verify', 'Local status not verified recently', 'Check the engine on site, then refresh this page. Do not assume audio is playing.', 'devices'));
    // A previously confirmed offline engine is reported as OFFLINE with last-known evidence,
    // never "currently playing". It remains unsafe for activation/takeover.
    if (report?.engine.state === 'offline_playing' && report.output.physical_verified && report.output.state === 'playing') {
      base.state = 'offline';
    }
    return base;
  }

  if (report.engine.state === 'offline_playing' && report.output.physical_verified && report.output.state === 'playing') {
    base.state = 'offline';
    base.issues.push(recovery('verify', 'Venue cannot be reached remotely', 'Local music was last confirmed running. Check on site; remote controls may not reach it.', 'devices'));
    return base;
  }
  if (browserOffline) {
    base.state = 'unknown';
    base.issues.push(recovery('verify', 'Connection to HQ is unavailable', 'Local playback may continue. Check the speaker in person before making changes.', 'devices'));
    return base;
  }

  if (report.engine.state !== 'ready') {
    base.issues.push(recovery('engine', 'Local engine not ready', 'Open the engine on the venue computer and check its service, then pair or restart it.', 'devices'));
  }
  if (report.engine.update_required) {
    base.issues.push(recovery('update', 'Local agent needs updating', 'Schedule an engine update outside service hours; confirm playback again afterwards.', 'devices'));
  }
  if (report.source.state !== 'connected') {
    const text = report.source.state === 'disconnected' ? 'Reconnect the authorised music drive on the venue computer.'
      : report.source.state === 'permission_required' ? 'Grant the local engine permission to the music folder.'
      : 'Connect an authorised local music source and rescan on the venue computer.';
    base.issues.push(recovery('source', 'Local music source unavailable', text, 'devices'));
  }

  const { verified, required } = report.inventory;
  if (!Number.isSafeInteger(verified) || !Number.isSafeInteger(required) || required < 1 || verified < 0 || verified > required || verified < required) {
    base.issues.push(recovery('media', 'Some required music is unverified', 'Repair or replace missing recordings locally; a candidate match cannot be played as an exact recording.', 'devices'));
  }
  const horizon = report.horizon;
  if (![horizon.committed_minutes, horizon.prepared_minutes, horizon.planned_minutes, horizon.fallback_minutes].every((value) => Number.isFinite(value) && value >= 0)
    || horizon.prepared_minutes < MIN_PREPARED_MINUTES || horizon.fallback_minutes < MIN_FALLBACK_MINUTES) {
    base.issues.push(recovery('fallback', 'Not enough prepared music or fallback', 'Prepare more eligible music for this zone and verify the offline fallback before opening.', 'schedule'));
  }
  if (!report.output.physical_verified || report.output.state === 'unknown' || report.output.state === 'untested') {
    base.issues.push(recovery('output', 'Physical speaker not verified', 'Test the real speaker output from the local engine. Unlocking a browser does not count.', 'devices'));
  }
  if (report.output.state === 'failed' || report.output.state === 'silent') {
    base.issues.push(recovery('output', 'Speaker has no confirmed audio', 'Check power, cabling, output selection and volume at the venue; test the real speaker.', 'devices'));
  }
  if (report.policy_approved !== true) {
    base.issues.push(recovery('policy', 'Venue policy not confirmed', 'Review the venue music policy and permissions before activating.', 'rules'));
  }
  if (report.offline_rehearsed !== true) {
    base.issues.push(recovery('rehearsal', 'Offline playback not rehearsed', 'Run an on-site internet-disconnect rehearsal and confirm music continues from authorised local media.', 'devices'));
  }
  if (venue.open_now && (zone.state === 'silent' || report.output.state === 'silent' || report.output.state === 'failed')) {
    base.state = 'silent';
  } else if (base.issues.length) {
    base.state = 'degraded';
  } else {
    // Closed/paused zones can be ready with a physically verified idle output; an open zone
    // needs confirmed playback to avoid claiming that an unlocked device is a speaker.
    const active = venue.open_now && zone.state !== 'paused_by_staff' && zone.state !== 'closed';
    if (active && report.output.state !== 'playing') {
      base.state = 'degraded';
      base.issues.push(recovery('output', 'No verified audio from the speaker', 'Confirm playback on the selected physical output.', 'devices'));
    } else base.state = 'healthy';
  }
  base.activationReady = base.state === 'healthy';
  return base;
}

export const READINESS_ORDER: ReadinessState[] = ['silent', 'degraded', 'offline', 'unknown', 'healthy'];
export const READINESS_WORDS: Record<ReadinessState, string> = {
  healthy: 'Healthy', degraded: 'Degraded', silent: 'Silent', offline: 'Offline', unknown: 'Unknown',
};

export function inspectVenue(venue: Venue, now: number, browserOffline = false) {
  const zones = venue.zones.map((zone) => inspectZone(zone, venue, now, browserOffline));
  const state = zones.length ? [...zones].sort((a, b) => READINESS_ORDER.indexOf(a.state) - READINESS_ORDER.indexOf(b.state))[0].state : 'unknown';
  return {
    venueId: venue.id,
    venueName: venue.name,
    state,
    zones,
    activationReady: zones.length > 0 && zones.every((zone) => zone.activationReady),
    missing: zones.filter((zone) => zone.verified == null || zone.required == null || zone.verified < zone.required).length,
  };
}

export function inspectFleet(venues: Venue[], now: number, browserOffline = false) {
  const venueStates = venues.map((venue) => inspectVenue(venue, now, browserOffline));
  const counts: Record<ReadinessState, number> = { healthy: 0, degraded: 0, silent: 0, offline: 0, unknown: 0 };
  for (const venue of venueStates) counts[venue.state] += 1;
  return { venues: venueStates, counts, ready: venueStates.filter((venue) => venue.activationReady).length };
}
