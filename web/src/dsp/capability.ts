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

/** The shared registry most callers use; tests may build their own. */
export const capabilities = new CapabilityRegistry();
