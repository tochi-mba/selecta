/** The per-feature capability record and registry (ADR-0459, BF-0459-01).
 *
 * Three tiers. Tier 1 is the baseline every qualified player has. Tier 2 features exist only on
 * measured devices. Tier 3 features need per-device benchmark evidence plus a model licence
 * review; in this release no Tier 3 feature is ever `ready`, so the registry refuses to record
 * one. `unsupported_here` is a first-class state with a reason, never an error.
 *
 * Every analysis or rendering result produced elsewhere in `web/src/dsp/` carries the
 * implementation id (name + version) of the code that made it, so a cached result imported from
 * another device can never be served as this device's own capability.
 */

import { KEY_IMPLEMENTATION } from './analysis/key';
import { ONSETS_IMPLEMENTATION } from './analysis/onsets';
import { TEMPO_IMPLEMENTATION } from './analysis/tempo';
import { CROSSFADE_IMPLEMENTATION } from './crossfade';
import { LIMITER_IMPLEMENTATION } from './limiter';
import { LOUDNESS_IMPLEMENTATION, TRUE_PEAK_IMPLEMENTATION } from './loudness';
import { SEAM_MOVES_IMPLEMENTATION } from './seamMoves';
import { SEAMS_IMPLEMENTATION } from './seams';
import { STRETCH_IMPLEMENTATION } from './stretchLimits';

/** How a seam meets a track from either music path: the whole file decoded before planning. */
export const WHOLE_FILE_DECODE_IMPLEMENTATION = 'whole-file-decode-v1';

export type Tier = 1 | 2 | 3;

export type CapabilityStatus = 'ready' | 'unsupported_here';

export interface Capability {
  /** Stable feature name, e.g. 'tempo', 'key', 'limiter', 'time_stretch'. */
  feature: string;
  tier: Tier;
  /** Implementation id and version, e.g. 'lightweight-chroma-v1'. Never a vague product claim. */
  implementation: string;
  status: CapabilityStatus;
  /** Required when status is 'unsupported_here': the plain reason shown to the member. */
  reason?: string;
  /** Optional overall confidence in [0, 1] for estimate-producing features. */
  confidence?: number;
}

/** Thrown when a record breaks the honesty rules rather than silently stored. */
export class CapabilityError extends Error {}

function validate(capability: Capability): Capability {
  if (!capability.feature) {
    throw new CapabilityError('A capability needs a feature name.');
  }
  if (!capability.implementation) {
    throw new CapabilityError(`'${capability.feature}' needs an implementation id and version.`);
  }
  if (capability.status === 'unsupported_here' && !capability.reason) {
    throw new CapabilityError(`'${capability.feature}' is unsupported_here but gives no reason.`);
  }
  if (capability.tier === 3 && capability.status === 'ready') {
    throw new CapabilityError(
      `'${capability.feature}' is Tier 3: per-device benchmark and licence evidence do not ` +
        'exist in this release, so it cannot be ready anywhere.'
    );
  }
  if (capability.confidence !== undefined) {
    if (!Number.isFinite(capability.confidence)) {
      throw new CapabilityError(`'${capability.feature}' has a non-finite confidence.`);
    }
    if (capability.confidence < 0 || capability.confidence > 1) {
      throw new CapabilityError(`'${capability.feature}' confidence must sit in [0, 1].`);
    }
  }
  return capability;
}

/** A registry keyed by feature. Registering the same feature again replaces its record. */
export class CapabilityRegistry {
  private readonly records = new Map<string, Capability>();

  register(capability: Capability): Capability {
    const checked = validate({ ...capability });
    this.records.set(checked.feature, checked);
    return checked;
  }

  get(feature: string): Capability | undefined {
    const found = this.records.get(feature);
    return found ? { ...found } : undefined;
  }

  list(): Capability[] {
    return [...this.records.values()]
      .map((record) => ({ ...record }))
      .sort((left, right) => left.feature.localeCompare(right.feature));
  }

  /** Convenience for recording a Tier 3 (or any) feature as honestly absent. */
  markUnsupported(feature: string, tier: Tier, implementation: string, reason: string): Capability {
    return this.register({ feature, tier, implementation, status: 'unsupported_here', reason });
  }
}

/** The shared registry most callers use; tests may build their own. Empty until evidence is
 * registered: importing this module claims nothing. */
export const capabilities = new CapabilityRegistry();

/** What this device has shown, which is all a capability may rest on (ADR-0459, ADR-0460). */
export interface DspEvidence {
  /** The ADR-0457 capability probe: a real worklet processed audio, or the reason it did not. */
  probe: { ok: true } | { ok: false; reason: string };
  /** The limiter actually installed in the playback graph. A fallback is a different, reduced
   * implementation and is recorded under its own id. Defaults to the worklet limiter. */
  limiter?: { kind: 'worklet' } | { kind: 'compressor_fallback'; implementation: string };
  /** Tier 2 needs a measured device: a benchmark-calibrated worker budget (budget.ts) that has
   * not collapsed to its floor. Absent means not measured, so Tier 2 is unsupported_here. */
  workerBudget?: { atFloor: boolean } | null;
  /** The time-stretch module loaded on this device and passed its self-test
   * (stretchLoader.ts loadStretchEvidence). Absent means not loaded, so stretch stays off. */
  stretch?: { implementation: string } | null;
}

/** Tier 3 features: none may be ready in this release (no benchmark or licence evidence). */
export const TIER3_FEATURES = ['neural_beats', 'neural_key', 'stem_separation', 'lyric_alignment'] as const;

const TIER3_REASON = 'needs per-device benchmark evidence and a model licence review, which do not exist yet';
const NOT_A_PLAYER = (reason: string) => `this device cannot play here: ${reason}`;

/** Register this device's DSP capabilities from evidence, never from hope.
 *  - Tier 1 is ready only when the probe passed; otherwise every Tier 1 feature is
 *    unsupported_here with the probe's reason (the device is a controller, ADR-0460).
 *  - Tier 2 is ready only on a measured device (probe passed and a calibrated budget exists and
 *    is not at its floor); time-stretch additionally needs its module loaded and self-tested
 *    on this device (stretchLoader.ts), else it stays unsupported_here.
 *  - Tier 3 is always unsupported_here. */
export function registerBrowserDspCapabilities(
  registry: CapabilityRegistry = capabilities,
  evidence: DspEvidence = { probe: { ok: false, reason: 'the capability probe has not run' } },
): CapabilityRegistry {
  const player = evidence.probe.ok;
  const playerReason = evidence.probe.ok ? '' : NOT_A_PLAYER(evidence.probe.reason);
  const tier1 = (feature: string, implementation: string) => (player
    ? registry.register({ feature, tier: 1, implementation, status: 'ready' })
    : registry.markUnsupported(feature, 1, implementation, playerReason));
  tier1('two_deck_playback', 'web-audio-two-deck-v1');
  tier1('crossfade', CROSSFADE_IMPLEMENTATION);
  tier1('prepared_fades', CROSSFADE_IMPLEMENTATION);
  tier1('loudness', LOUDNESS_IMPLEMENTATION);
  tier1('true_peak', TRUE_PEAK_IMPLEMENTATION);
  const limiter = evidence.limiter ?? { kind: 'worklet' };
  tier1('limiter', limiter.kind === 'worklet' ? LIMITER_IMPLEMENTATION : limiter.implementation);
  // The seam move chain (seamMoves.ts): reduced minimum-phase biquads, under their own id.
  tier1('eq_filters', SEAM_MOVES_IMPLEMENTATION);
  // Both music paths decode the whole file before a seam is planned, so either may meet the
  // other mid-seam (ADR-0465 coexistence: the capability record says both paths are seam-safe).
  tier1('seam_source_device', WHOLE_FILE_DECODE_IMPLEMENTATION);
  tier1('seam_source_hosted', WHOLE_FILE_DECODE_IMPLEMENTATION);

  const budget = evidence.workerBudget ?? null;
  const tier2Reason = !player
    ? playerReason
    : !budget
      ? 'this device has not been measured yet, so lightweight analysis stays off'
      : budget.atFloor
        ? 'this device is out of headroom, so lightweight analysis is paused'
        : '';
  const tier2 = (feature: string, implementation: string) => (tier2Reason
    ? registry.markUnsupported(feature, 2, implementation, tier2Reason)
    : registry.register({ feature, tier: 2, implementation, status: 'ready' }));
  tier2('onsets', ONSETS_IMPLEMENTATION);
  tier2('tempo', TEMPO_IMPLEMENTATION);
  tier2('key', KEY_IMPLEMENTATION);
  tier2('beatmatch', SEAMS_IMPLEMENTATION);
  const stretch = evidence.stretch ?? null;
  const stretchLoaded = stretch !== null && stretch.implementation === STRETCH_IMPLEMENTATION;
  if (!tier2Reason && !stretchLoaded) {
    registry.markUnsupported('time_stretch', 2, STRETCH_IMPLEMENTATION, 'the time-stretch module has not loaded on this device');
  } else {
    tier2('time_stretch', STRETCH_IMPLEMENTATION);
  }

  for (const feature of TIER3_FEATURES) registry.markUnsupported(feature, 3, `${feature.replace(/_/g, '-')}-unavailable-v0`, TIER3_REASON);
  return registry;
}
