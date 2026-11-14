/** Cross-agent adapters. Runtime modules must not import Cloud API, Python or device file paths.
 * Agent 01 owns musical transitions; Agent 02 owns exact media bindings;
 * Agent 06 owns authenticated versioned Cloud control sessions.
 */
import type { VenueAudioPort, PlayerSnapshot } from './browserAudio';
import type { VenuePolicy, RecordingPolicyFacts } from './policy';

export interface CanonicalLocalMediaPort {
  /** Stable canonical ID + verified exact revision. No local filename or raw bytes. */
  eligible(zoneId: string, canonicalId: string, revision: string): Promise<RecordingPolicyFacts>;
  /** Bind locally granted File, never a Cloud audio URL. */
  resolveFile(zoneId: string, canonicalId: string, revision: string): Promise<File | null>;
  sourceState(zoneId: string): Promise<'connected' | 'permission_required' | 'missing'>;
}

export interface CloudVenueSessionPort {
  /** Returns a fenced, zone-scoped generation or refuses takeover. */
  acquire(args: { workspaceId: string; venueId: string; zoneId: string; deviceId: string }): Promise<{ generation: number; expiresAt: number }>;
  /** Metadata/health only. No File, Blob, sample, local handle or signed URL. */
  report(args: {
    workspaceId: string; venueId: string; zoneId: string; deviceId: string;
    generation: number; phase: PlayerSnapshot['phase']; foreground: boolean;
    sourceReady: boolean; outputOperatorCheckedAt: number | null;
    lastSeenEpochMs: number; committedMinutes: number; preparedMinutes: number; plannedMinutes: number;
  }): Promise<void>;
  commandReceipt(args: { operationId: string; generation: number; state: 'accepted' | 'applied' | 'rejected' | 'conflicted' }): Promise<void>;
}

export interface VenueProgrammePort {
  policy(zoneId: string): Promise<VenuePolicy>;
  /** Only canonical identity/revision, no paths or audio payloads. */
  horizon(zoneId: string): Promise<{
    committed: readonly { id: string; revision: string }[];
    prepared: readonly { id: string; revision: string }[];
    planned: readonly { id: string; revision: string }[];
    fallback: readonly { id: string; revision: string }[];
  }>;
  /** Locally acknowledged speaker observation, not Cloud acceptance. */
  requestProgress(requestId: string, stage: 'prepared' | 'locally_scheduled' | 'played' | 'rejected' | 'expired'): Promise<void>;
}

export type BrowserVenueIntegrations = {
  audio: VenueAudioPort;
  media: CanonicalLocalMediaPort;
  cloud: CloudVenueSessionPort;
  programme: VenueProgrammePort;
};

/** A session may only claim readiness once these independent ports report evidence. */
export function sessionIsPlayReady(input: {
  foreground: boolean; sourceReady: boolean; policyReady: boolean;
  generation: number; speakerCheckedAt: number | null; now: number;
}): boolean {
  return input.foreground && input.sourceReady && input.policyReady
    && Number.isSafeInteger(input.generation) && input.generation > 0
    && input.speakerCheckedAt !== null && input.speakerCheckedAt <= input.now
    && input.now - input.speakerCheckedAt <= 120_000;
}
