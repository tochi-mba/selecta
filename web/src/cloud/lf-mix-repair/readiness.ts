/**
 * LF11: presentation contract for device-owned media. These statuses come from an
 * authorised local-engine verifier, never cloud assets, cached waveforms, or AI.
 * Unknown is the safe default while LF03/LF07 integrations are unavailable.
 */
export const MEDIA_STATES = [
  'Ready', 'Missing', 'Candidate', 'Version Mismatch', 'Source Disconnected',
  'Permission Required', 'Unsupported', 'Blocked', 'Unknown', 'Cache Invalid',
] as const;
export type MediaState = typeof MEDIA_STATES[number];

export type DeviceTarget = {
  id: string;
  name: string;
  controllerOnly?: boolean;
  connected?: boolean;
  outputVerified?: boolean;
  ownsPlayback?: boolean;
  rightsAllowed?: boolean;
  committedUntil?: number | null;
};

export type TrackReference = {
  occurrenceId: string;
  recordingId: string;
  title: string;
  artist?: string | null;
  explicit?: boolean | null;
  version?: string | null;
};
export type VerifiedTrack = {
  occurrenceId: string;
  state: MediaState;
  reason?: string;
  verifiedAt?: number | null;
  candidateId?: string;
  candidateVersion?: string;
  candidateExplicit?: boolean | null;
  equivalentVerified?: boolean;
  cueValid?: boolean;
  seamValid?: boolean;
  previewValid?: boolean;
};
export type DeviceMixReadiness = {
  deviceId: string;
  mixId: string;
  revision: string;
  checkedAt: number | null;
  tracks: VerifiedTrack[];
  engineHealthy: boolean;
  outputVerified: boolean;
  policyAllowed: boolean;
  playbackWindowFree: boolean;
  sourceConnected: boolean;
  /* A verifier must explicitly attest to a local source, never just an asset id. */
  localVerification: boolean;
};

export type MixCapabilities = {
  editable: true;
  renderable: boolean;
  auditionable: boolean;
  playable: boolean;
  reason: string;
};
export type ReadinessCounts = {
  ready: number;
  total: number;
  unresolved: number;
  stale: boolean;
  states: Record<MediaState, number>;
  capabilities: MixCapabilities;
};

export const VERIFICATION_TTL_MS = 120_000;
const STATES = new Set<string>(MEDIA_STATES);
const own = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const yes = (v: unknown) => v === true;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const verifiedTime = (v: unknown): number | null =>
  finite(v) && v > 0 && v < 9e15 ? v : null;

/** Never let a response for another recipe, device, revision or duplicate track
 * quietly count toward readiness. The entire result is Unknown on mismatch. */
export function acceptReadiness(
  raw: unknown,
  expected: { deviceId: string; mixId: string; revision: string; tracks: TrackReference[] },
): DeviceMixReadiness | null {
  if (!own(raw) || raw.device_id !== expected.deviceId ||
      raw.mix_id !== expected.mixId || raw.revision !== expected.revision ||
      !Array.isArray(raw.tracks) || raw.tracks.length !== expected.tracks.length) return null;
  const rows: VerifiedTrack[] = [];
  for (let i = 0; i < expected.tracks.length; i++) {
    const row: unknown = raw.tracks[i];
    if (!own(row) || row.occurrence_id !== expected.tracks[i].occurrenceId ||
        !str(row.state) || !STATES.has(row.state)) return null;
    rows.push({
      occurrenceId: expected.tracks[i].occurrenceId,
      // Ready must be attested by this specific, recently verified local engine.
      state: row.state as MediaState,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      verifiedAt: verifiedTime(row.verified_at),
      candidateId: str(row.candidate_id) ? row.candidate_id : undefined,
      candidateVersion: str(row.candidate_version) ? row.candidate_version : undefined,
      candidateExplicit: typeof row.candidate_explicit === 'boolean' ? row.candidate_explicit : null,
      equivalentVerified: yes(row.equivalent_verified),
      cueValid: yes(row.cue_valid),
      seamValid: yes(row.seam_valid),
      previewValid: yes(row.preview_valid),
    });
  }
  return {
    deviceId: expected.deviceId, mixId: expected.mixId, revision: expected.revision,
    checkedAt: verifiedTime(raw.checked_at),
    tracks: rows, engineHealthy: yes(raw.engine_healthy),
    outputVerified: yes(raw.output_verified), policyAllowed: yes(raw.policy_allowed),
    playbackWindowFree: yes(raw.playback_window_free), sourceConnected: yes(raw.source_connected),
    localVerification: yes(raw.local_verification),
  };
}

export function unknownReadiness(
  deviceId: string, mixId: string, revision: string, tracks: TrackReference[],
): DeviceMixReadiness {
  return {
    deviceId, mixId, revision, checkedAt: null,
    tracks: tracks.map(t => ({ occurrenceId: t.occurrenceId, state: 'Unknown' })),
    engineHealthy: false, outputVerified: false, policyAllowed: false,
    playbackWindowFree: false, sourceConnected: false, localVerification: false,
  };
}

export function isStale(readiness: DeviceMixReadiness, now = Date.now()): boolean {
  return !readiness.localVerification || !readiness.engineHealthy || !readiness.sourceConnected ||
    readiness.checkedAt === null || readiness.checkedAt > now + 5_000 ||
    now - readiness.checkedAt > VERIFICATION_TTL_MS;
}

/** A track claim must be recent too; a fresh aggregate heartbeat can contain
 * old per-file observations. It must never resurrect a disconnected file. */
export function isTrackReady(track: VerifiedTrack, now = Date.now()): boolean {
  return track.state === 'Ready' && track.verifiedAt !== null &&
    track.verifiedAt !== undefined && track.verifiedAt <= now + 5_000 &&
    now - track.verifiedAt <= VERIFICATION_TTL_MS;
}

/** Separate editability, file rendering, partial audition, and actual speaker
 * playback. Never equate 'some local audio' with a safe mix takeover. */
export function capabilitiesFor(readiness: DeviceMixReadiness, now = Date.now()): MixCapabilities {
  const stale = isStale(readiness, now);
  const all = readiness.tracks.length > 0 &&
    readiness.tracks.every(t => isTrackReady(t, now) && t.cueValid && t.seamValid);
  const any = readiness.tracks.some(t => isTrackReady(t, now) && t.previewValid);
  const common = !stale && readiness.engineHealthy && readiness.sourceConnected && readiness.policyAllowed;
  const renderable = common && all;
  const auditionable = common && any;
  const playable = renderable && readiness.outputVerified && readiness.playbackWindowFree;
  const reason = stale ? 'Local verification is missing or stale.'
    : !readiness.engineHealthy ? 'The selected engine is not healthy.'
    : !readiness.sourceConnected ? 'The local music source is disconnected.'
    : !readiness.policyAllowed ? 'Content or venue policy prevents playback.'
    : !all ? 'Some recordings, cues or transitions are not ready.'
    : !readiness.outputVerified ? 'Actual speaker output has not been verified.'
    : !readiness.playbackWindowFree ? 'A committed playback window must be respected.'
    : 'The local engine reports the full recipe ready.';
  return { editable: true, renderable, auditionable, playable, reason };
}

export function countReadiness(readiness: DeviceMixReadiness, now = Date.now()): ReadinessCounts {
  const states = Object.fromEntries(MEDIA_STATES.map(state => [state, 0])) as Record<MediaState, number>;
  const stale = isStale(readiness, now);
  for (const track of readiness.tracks) {
    const state = stale || (track.state === 'Ready' && !isTrackReady(track, now))
      ? 'Unknown' : track.state;
    states[state] += 1;
  }
  const ready = states.Ready;
  return {
    ready, total: readiness.tracks.length, unresolved: readiness.tracks.length - ready,
    stale, states,
    capabilities: capabilitiesFor(readiness, now),
  };
}

/** Preserve duplicate occurrences even when two tracks refer to the same file.
 * Stable IDs from LF04 are preferred; this fallback is scoped to a recipe revision. */
export function referencesOf(songs: ReadonlyArray<{
  id: string; title: string; artist?: string | null; occurrence_id?: string;
  explicit?: boolean | null; version?: string | null;
}>): TrackReference[] {
  return songs.map((song, index) => ({
    occurrenceId: song.occurrence_id || `legacy:${index}:${song.id}`,
    recordingId: song.id, title: song.title, artist: song.artist ?? null,
    explicit: song.explicit ?? null, version: song.version ?? null,
  }));
}

export function canAcceptCandidate(
  reference: TrackReference, candidate: VerifiedTrack,
): boolean {
  // A lookup suggestion cannot silently change clean/explicit, remaster, radio
  // edit, live version or recording identity, regardless of text similarity.
  return candidate.state === 'Candidate' && candidate.equivalentVerified === true &&
    candidate.candidateExplicit !== null && candidate.candidateExplicit !== undefined &&
    reference.explicit !== null && reference.explicit !== undefined &&
    candidate.candidateExplicit === reference.explicit &&
    !!reference.version && candidate.candidateVersion === reference.version &&
    !!candidate.candidateId && candidate.candidateId === reference.recordingId;
}

export type RepairVariation = {
  originalRevision: string;
  fromMixId: string;
  orderedOccurrenceIds: string[];
  skippedOccurrenceIds: string[];
  temporary: true;
};
/** A variation is a separate ephemeral plan; it never mutates the saved mix. */
export function createTemporaryVariation(
  mixId: string, revision: string, tracks: TrackReference[], availability: DeviceMixReadiness,
  now = Date.now(),
): RepairVariation | null {
  if (isStale(availability, now) || availability.mixId !== mixId || availability.revision !== revision ||
      !availability.engineHealthy || !availability.sourceConnected || !availability.policyAllowed) return null;
  const ordered = tracks.filter(t =>
    availability.tracks.some(a => a.occurrenceId === t.occurrenceId && isTrackReady(a, now))).map(t => t.occurrenceId);
  if (!ordered.length) return null;
  return {
    fromMixId: mixId, originalRevision: revision,
    orderedOccurrenceIds: ordered,
    skippedOccurrenceIds: tracks.filter(t => !ordered.includes(t.occurrenceId)).map(t => t.occurrenceId),
    temporary: true,
  };
}

/** A substituted recording invalidates every dependent artifact until a local
 * verifier recomputes it. Never reuse the old waveform, stems, cues or seam. */
export function invalidateSubstitution(
  tracks: ReadonlyArray<VerifiedTrack>, occurrenceId: string,
): VerifiedTrack[] {
  return tracks.map((track, index) => {
    const at = tracks.findIndex(t => t.occurrenceId === occurrenceId);
    if (index === at) return { ...track, state: 'Cache Invalid', cueValid: false, seamValid: false, previewValid: false };
    if (index === at + 1) return { ...track, seamValid: false, previewValid: false };
    return { ...track };
  });
}
