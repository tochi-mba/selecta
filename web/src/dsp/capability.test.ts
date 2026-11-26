import { describe, expect, it } from 'vitest';
import { TEMPO_IMPLEMENTATION } from './analysis/tempo';
import {
  capabilities,
  CapabilityError,
  CapabilityRegistry,
  registerBrowserDspCapabilities,
  stemSeparationEvidenceState,
  STEMS_LICENCE_REASON,
  STEMS_LICENCE_RECORD,
  TIER3_FEATURES,
  type StemEvidence,
} from './capability';
import { STEM_CALIBRATION_IMPLEMENTATION, type StemCalibration } from './stems/gate';
import { STEM_MODEL_ARTEFACT } from './stems/model';
import { loadStretchEvidence } from './stretchLoader';
import { CROSSFADE_IMPLEMENTATION } from './crossfade';
import { LIMITER_IMPLEMENTATION } from './limiter';
import { TRUE_PEAK_IMPLEMENTATION } from './loudness';
import { WORKER_CALIBRATION_IMPLEMENTATION, WORKER_CALIBRATION_MAX_AGE_MS, type WorkerBudgetEvidence } from './budget';
import { STRETCH_PLAYBACK_INTEGRATION } from './stretchLimits';
import { BEATS_NOT_SIGNED_REASON } from './analysis/beatThis/gate';
import { BEAT_MODEL_IMPLEMENTATION, BEATS_LICENCE_RECORD } from './analysis/beatThis/model';

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

const STEM_SHA = 'ab'.repeat(32);
function stemBenchmark(secondsPerAudioSecond = 0.2): StemCalibration {
  return {
    implementation: STEM_CALIBRATION_IMPLEMENTATION,
    deviceId: TEST_DEVICE,
    modelImplementation: 'htdemucs-onnx-v1',
    modelSha256: STEM_SHA,
    backend: 'webgpu',
    calibratedAt: CALIBRATION_NOW,
    audioSeconds: 7.8,
    secondsPerAudioSecond,
  };
}
function stemEvidence(licenceRecord: string | null): StemEvidence {
  return { licenceRecord, modelSha256: STEM_SHA, deviceId: TEST_DEVICE, benchmark: stemBenchmark(), crashGuard: { clear: true } };
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

  it('never makes a Tier 3 feature ready in this build, whatever the evidence', () => {
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW, stems: stemEvidence('bf-tier3-htdemucs-2026-11-19'),
    });
    for (const feature of TIER3_FEATURES) {
      expect(registry.get(feature)).toMatchObject({ tier: 3, status: 'unsupported_here' });
    }
    expect(registry.get('stem_separation')).toMatchObject({ implementation: 'htdemucs-onnx-v1', reason: STEMS_LICENCE_REASON });
  });

  it('stem separation is pending licence review: no record, no artefact, so unsupported_here on every device', () => {
    expect(STEMS_LICENCE_RECORD).toBeNull();
    expect(STEM_MODEL_ARTEFACT).toBeNull();
    const failedProbe = registerBrowserDspCapabilities(new CapabilityRegistry(), { probe: { ok: false, reason: 'no worklet' } });
    expect(failedProbe.get('stem_separation')?.reason).toBe(STEMS_LICENCE_REASON);
    const registry = new CapabilityRegistry();
    expect(() => registry.register({ feature: 'stem_separation', tier: 3, implementation: 'htdemucs-onnx-v1', status: 'ready' }, stemEvidence('bf-tier3-htdemucs-2026-11-19')))
      .toThrow(/licence is still under review/);
  });

  it('the stem evidence check needs every condition once a licence record passes', () => {
    const passedRecords = ['bf-tier3-htdemucs-pass'];
    const options = { passedRecords, modelSha256: STEM_SHA, now: CALIBRATION_NOW };
    expect(stemSeparationEvidenceState(stemEvidence('bf-tier3-htdemucs-pass'), options)).toEqual({ supported: true });
    expect(stemSeparationEvidenceState(stemEvidence('some-other-record'), options)).toEqual({ supported: false, reason: STEMS_LICENCE_REASON });
    expect(stemSeparationEvidenceState(stemEvidence('bf-tier3-htdemucs-pass'), { ...options, modelSha256: null }))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/not published/) });
    expect(stemSeparationEvidenceState({ ...stemEvidence('bf-tier3-htdemucs-pass'), modelSha256: 'ff'.repeat(32) }, options))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/not the published one/) });
    expect(stemSeparationEvidenceState({ ...stemEvidence('bf-tier3-htdemucs-pass'), crashGuard: { clear: false, reason: 'the last attempt to split stems on this device stopped the page', at: null } }, options))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/stopped the page/) });
    expect(stemSeparationEvidenceState({ ...stemEvidence('bf-tier3-htdemucs-pass'), benchmark: stemBenchmark(0.8) }, options))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/too slowly/) });
    expect(stemSeparationEvidenceState({ ...stemEvidence('bf-tier3-htdemucs-pass'), deviceId: 'another' }, options))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/different device/) });
    expect(stemSeparationEvidenceState({ ...stemEvidence('bf-tier3-htdemucs-pass'), budgetAtFloor: true }, options))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/headroom/) });
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

  it('refuses a Tier 3 feature marked ready without passing evidence', () => {
    expect(() => new CapabilityRegistry().register({ feature: 'neural_key', tier: 3, implementation: 'x-v1', status: 'ready' }, stemEvidence('anything')))
      .toThrow(CapabilityError);
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

describe('neural beats (Beat This in the browser)', () => {
  it('is unsupported_here on every device while its Tier 3 record is open, whatever the device showed', () => {
    expect(BEATS_LICENCE_RECORD).toBeNull();
    const registry = registerBrowserDspCapabilities(new CapabilityRegistry(), {
      probe: { ok: true }, workerBudget: workerEvidence(), now: CALIBRATION_NOW, neuralBeats: { supported: true },
    });
    expect(registry.get('neural_beats')).toMatchObject({
      tier: 3, status: 'unsupported_here', implementation: BEAT_MODEL_IMPLEMENTATION, reason: BEATS_NOT_SIGNED_REASON,
    });
  });

  it('refuses a ready record without a passed record', () => {
    expect(() => new CapabilityRegistry().register(
      { feature: 'neural_beats', tier: 3, implementation: BEAT_MODEL_IMPLEMENTATION, status: 'ready' }, { supported: true },
    )).toThrow(CapabilityError);
  });
});
