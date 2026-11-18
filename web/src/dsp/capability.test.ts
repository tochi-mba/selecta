import { describe, expect, it } from 'vitest';
import { TEMPO_IMPLEMENTATION } from './analysis/tempo';
import {
  capabilities,
  CapabilityError,
  CapabilityRegistry,
  registerBrowserDspCapabilities,
  TIER3_FEATURES,
} from './capability';
import { loadStretchEvidence } from './stretchLoader';
import { CROSSFADE_IMPLEMENTATION } from './crossfade';
import { LIMITER_IMPLEMENTATION } from './limiter';
import { TRUE_PEAK_IMPLEMENTATION } from './loudness';
import { WORKER_CALIBRATION_IMPLEMENTATION, WORKER_CALIBRATION_MAX_AGE_MS, type WorkerBudgetEvidence } from './budget';
import { STRETCH_PLAYBACK_INTEGRATION } from './stretchLimits';

const CALIBRATION_NOW = 1_700_000_000_000;
const TEST_DEVICE = 'device-capability-test';
function workerEvidence(atFloor = false, calibratedAt = CALIBRATION_NOW, deviceId = TEST_DEVICE): WorkerBudgetEvidence {
  return {
    calibration: {
      implementation: WORKER_CALIBRATION_IMPLEMENTATION,
      deviceId,
      calibratedAt,
      samples: 3,
      msPerBlock: 12,
      horizonS: 30,
    },
    deviceId,
    atFloor,
    deadlineMisses: 0,
  };
}

describe('capability registry', () => {
  it('claims nothing without evidence: importing the module leaves the shared registry empty', () => {
    expect(capabilities.list()).toEqual([]);
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry());
    expect(registry.list().every((record) => record.status === 'unsupported_here')).toBe(true);
  });

  it('a passing probe makes Tier 1 ready under the real implementation ids, Tier 2 waits for measurement', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true } });
    expect(registry.get('crossfade')).toMatchObject({ tier: 1, status: 'ready', implementation: CROSSFADE_IMPLEMENTATION });
    expect(registry.get('limiter')).toMatchObject({ tier: 1, status: 'ready', implementation: LIMITER_IMPLEMENTATION });
    expect(registry.get('true_peak')).toMatchObject({ status: 'ready', implementation: TRUE_PEAK_IMPLEMENTATION });
    expect(registry.get('tempo')).toMatchObject({ tier: 2, status: 'unsupported_here', reason: expect.stringMatching(/not been measured/) });
    expect(registry.get('time_stretch')).toMatchObject({
      tier: 2, status: 'unsupported_here', implementation: 'wsola-stretch-v1',
    });
  });

  it('a measured device gets Tier 2 under the analysis modules own ids; a collapsed budget pauses it', () => {
    const measured = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW });
    expect(measured.get('tempo')).toMatchObject({ tier: 2, status: 'ready', implementation: TEMPO_IMPLEMENTATION });
    expect(measured.get('time_stretch')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/has not loaded/) });
    const collapsed = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(true), now: CALIBRATION_NOW });
    expect(collapsed.get('key')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/headroom/) });
  });

  it('time-stretch is ready only on a measured device whose stretch module loaded and self-tested', async () => {
    const evidence = await loadStretchEvidence();
    expect(evidence).toEqual({ implementation: 'wsola-stretch-v1' });
    const ready = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW, stretch: evidence, stretchPlaybackIntegration: STRETCH_PLAYBACK_INTEGRATION });
    expect(ready.get('time_stretch')).toMatchObject({ tier: 2, status: 'ready', implementation: 'wsola-stretch-v1' });
    const unmeasured = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, stretch: evidence });
    expect(unmeasured.get('time_stretch')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/not been measured/) });
    const failedLoad = await loadStretchEvidence(async () => { throw new Error('chunk failed to load'); });
    expect(failedLoad).toBeNull();
    const wrongId = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW, stretch: { implementation: 'something-else' } });
    expect(wrongId.get('time_stretch')?.status).toBe('unsupported_here');
  });

  it('a failed probe makes every Tier 1 feature unsupported_here with the probe reason', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: false, reason: 'the audio worklet never processed audio' },
      workerBudget: workerEvidence(),
      now: CALIBRATION_NOW,
    });
    for (const feature of ['two_deck_playback', 'crossfade', 'limiter', 'tempo']) {
      expect(registry.get(feature)).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/never processed/) });
    }
  });

  it('names the compressor fallback as its own reduced implementation', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true },
      limiter: { kind: 'compressor_fallback', implementation: 'dynamics-compressor-safety-v1' },
    });
    expect(registry.get('limiter')).toMatchObject({ status: 'ready', implementation: 'dynamics-compressor-safety-v1' });
  });

  it('never makes a Tier 3 feature ready, whatever the evidence', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW });
    for (const feature of TIER3_FEATURES) {
      expect(registry.get(feature)).toMatchObject({ tier: 3, status: 'unsupported_here' });
    }
  });

  it('keeps Tier 2 unavailable for stale, future-dated or differently bound calibration', () => {
    const stale = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true }, workerBudget: workerEvidence(false, CALIBRATION_NOW - WORKER_CALIBRATION_MAX_AGE_MS - 1), now: CALIBRATION_NOW,
    });
    expect(stale.get('tempo')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/stale|invalid/) });
    const future = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true }, workerBudget: workerEvidence(false, CALIBRATION_NOW + 1), now: CALIBRATION_NOW,
    });
    expect(future.get('tempo')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/stale|invalid/) });
    const mismatch = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true }, workerBudget: { ...workerEvidence(false, CALIBRATION_NOW, 'other-device'), deviceId: TEST_DEVICE }, now: CALIBRATION_NOW,
    });
    expect(mismatch.get('tempo')).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/different device/) });
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
