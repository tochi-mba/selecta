import { describe, expect, it } from 'vitest';
import { BANNED_CLAIMS, labelFor, violatesHonesty } from './honesty';
import type { Capability } from './capability';

describe('honest labelling', () => {
  it('bans the native-parity claims the ADR names', () => {
    expect(BANNED_CLAIMS).toContain('same as the native engine');
    expect(BANNED_CLAIMS).toContain('studio-grade stems on any phone');
    expect(violatesHonesty('This mix is the Same as the Native Engine!')).toBe(true);
    expect(violatesHonesty('estimated tempo (lightweight)')).toBe(false);
  });

  it('labels a Tier 2 estimate as an estimate, never as the neural engine', () => {
    const tempo: Capability = {
      feature: 'tempo',
      tier: 2,
      implementation: 'onset-autocorrelation-tempo-v1',
      status: 'ready',
    };
    expect(labelFor(tempo)).toBe('estimated tempo (lightweight)');
    const key: Capability = {
      feature: 'key',
      tier: 2,
      implementation: 'lightweight-chroma-v1',
      status: 'ready',
    };
    expect(labelFor(key)).toBe('estimated key (lightweight)');
  });

  it('labels unsupported_here with the recorded reason', () => {
    const stretch: Capability = {
      feature: 'time_stretch',
      tier: 2,
      implementation: 'time-stretch-unsupported-v0',
      status: 'unsupported_here',
      reason: 'no vetted pitch-preserving stretch is bundled',
    };
    expect(labelFor(stretch)).toBe(
      'not available on this device: no vetted pitch-preserving stretch is bundled'
    );
  });

  it('no label it produces contains a banned claim', () => {
    const samples: Capability[] = [
      { feature: 'tempo', tier: 2, implementation: 'x-v1', status: 'ready' },
      { feature: 'limiter', tier: 1, implementation: 'y-v1', status: 'ready' },
      { feature: 'unknown_thing', tier: 2, implementation: 'z-v1', status: 'ready' },
      {
        feature: 'stems',
        tier: 3,
        implementation: 'w-v0',
        status: 'unsupported_here',
        reason: 'needs benchmark and licence evidence',
      },
    ];
    for (const capability of samples) {
      expect(violatesHonesty(labelFor(capability))).toBe(false);
    }
  });
});
