import { describe, expect, it } from 'vitest';
import { CapabilityError, CapabilityRegistry, registerBrowserDspCapabilities } from './capability';

describe('capability registry', () => {
  it('registers implemented tiers and keeps time-stretch honestly unavailable', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry());
    expect(registry.get('crossfade')).toMatchObject({ tier: 1, status: 'ready', implementation: 'equal-power-crossfade-v1' });
    expect(registry.get('tempo')).toMatchObject({ tier: 2, status: 'ready', implementation: 'lightweight-tempo-v1' });
    expect(registry.get('time_stretch')).toMatchObject({
      tier: 2, status: 'unsupported_here', implementation: 'time-stretch-unsupported-v0',
    });
  });
  it('round-trips a record through register, get and list', () => {
    const registry = new CapabilityRegistry();
    registry.register({
      feature: 'tempo',
      tier: 2,
      implementation: 'onset-autocorrelation-tempo-v1',
      status: 'ready',
      confidence: 0.8,
    });
    registry.register({
      feature: 'crossfade',
      tier: 1,
      implementation: 'equal-power-crossfade-v1',
      status: 'ready',
    });
    const tempo = registry.get('tempo');
    expect(tempo?.implementation).toBe('onset-autocorrelation-tempo-v1');
    expect(tempo?.tier).toBe(2);
    expect(registry.list().map((record) => record.feature)).toEqual(['crossfade', 'tempo']);
    expect(registry.get('stems')).toBeUndefined();
  });

  it('returns copies, so callers cannot mutate the registry from outside', () => {
    const registry = new CapabilityRegistry();
    registry.register({
      feature: 'key',
      tier: 2,
      implementation: 'lightweight-chroma-v1',
      status: 'ready',
    });
    const record = registry.get('key');
    if (record) {
      record.implementation = 'tampered';
    }
    expect(registry.get('key')?.implementation).toBe('lightweight-chroma-v1');
  });

  it('refuses a Tier 3 feature marked ready: no benchmark or licence evidence exists', () => {
    const registry = new CapabilityRegistry();
    expect(() =>
      registry.register({
        feature: 'stem_separation',
        tier: 3,
        implementation: 'demucs-wasm-v0',
        status: 'ready',
      })
    ).toThrow(CapabilityError);
    // The honest shape is accepted.
    const honest = registry.markUnsupported(
      'stem_separation',
      3,
      'demucs-wasm-v0',
      'needs per-device benchmark evidence and a model licence review'
    );
    expect(honest.status).toBe('unsupported_here');
  });

  it('requires a reason for unsupported_here and a confidence inside [0, 1]', () => {
    const registry = new CapabilityRegistry();
    expect(() =>
      registry.register({
        feature: 'time_stretch',
        tier: 2,
        implementation: 'time-stretch-unsupported-v0',
        status: 'unsupported_here',
      })
    ).toThrow(CapabilityError);
    expect(() =>
      registry.register({
        feature: 'tempo',
        tier: 2,
        implementation: 'onset-autocorrelation-tempo-v1',
        status: 'ready',
        confidence: 1.5,
      })
    ).toThrow(CapabilityError);
  });
});
