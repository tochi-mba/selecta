import { describe, expect, it } from 'vitest';
import * as engineSurface from './index';
import { buildCapabilityRoster, createEngine } from './index';
import { LIMITER_IMPLEMENTATION } from '../dsp/limiter';
import { WORKER_CALIBRATION_IMPLEMENTATION, type WorkerBudgetEvidence } from '../dsp/budget';
import { FakeAudioContext, FakeDocument } from './testAudio';

const CALIBRATED_AT = 1_700_000_000_000;
const DEVICE_ID = 'engine-roster-test-device';
const workerBudget: WorkerBudgetEvidence = {
  calibration: {
    implementation: WORKER_CALIBRATION_IMPLEMENTATION,
    deviceId: DEVICE_ID,
    calibratedAt: CALIBRATED_AT,
    samples: 3,
    msPerBlock: 12,
    horizonS: 30,
  },
  deviceId: DEVICE_ID,
  atFloor: false,
  deadlineMisses: 0,
};

describe('the engine owner', () => {
  it('closes every context it opened when the runtime is disposed', () => {
    const engine = createEngine();
    const context = new FakeAudioContext();
    const opened = engine.openContext({
      fromUserGesture: true,
      create: () => context as unknown as AudioContext,
      watchDocument: new FakeDocument(),
      watchMediaDevices: null,
    });
    expect('context' in opened).toBe(true);
    expect(context.state).toBe('running');
    engine.dispose();
    expect(context.state).toBe('closed');
  });
});

describe('the public surface the interface uses', () => {
  it('exports the runtime, probe, speaker, render, export and capability pieces', () => {
    for (const name of ['createEngine', 'probeCapability', 'BrowserSpeaker', 'renderMix', 'exportWav', 'encodeWav', 'flacSupported', 'buildCapabilityRoster', 'installLimiter']) {
      expect(typeof (engineSurface as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('a speaker made after dispose is disposed at once, never a live orphan', () => {
    const engine = createEngine();
    engine.dispose();
    const context = new FakeAudioContext();
    const speaker = engine.createSpeaker({
      audio: { context: context as unknown as AudioContext, wake: async () => true, hold: async () => {} },
      probe: { ok: true, sampleRate: 44100, schedulingMisses: 0, blocks: 32 },
      resolve: async () => null,
    });
    expect(speaker.active()).toBe(false);
    expect(speaker.position()).toBeNull();
  });
});

describe('the capability roster', () => {
  const passed = { ok: true as const, sampleRate: 44100, schedulingMisses: 0, blocks: 32 };

  it('makes Tier 1 ready only with a passing probe, naming the limiter actually installed', () => {
    const worklet = buildCapabilityRoster({ probe: passed, limiter: { kind: 'worklet', implementation: LIMITER_IMPLEMENTATION, latencySeconds: 0.08 } });
    expect(worklet.get('two_deck_playback')?.status).toBe('ready');
    expect(worklet.get('limiter')).toMatchObject({ tier: 1, status: 'ready', implementation: LIMITER_IMPLEMENTATION });
    const unknown = buildCapabilityRoster({ probe: passed });
    expect(unknown.get('limiter')?.implementation).toBe('dynamics-compressor-safety-v1');
  });

  it('a failed probe leaves only unsupported_here records, each with the reason', () => {
    const roster = buildCapabilityRoster({ probe: { ok: false, state: 'unsupported_here', reason: 'no AudioWorklet here' } });
    for (const record of roster.list()) {
      expect(record.status).toBe('unsupported_here');
      expect(record.reason).toBeTruthy();
    }
    expect(roster.get('crossfade')?.reason).toMatch(/no AudioWorklet here/);
  });

  it('Tier 2 needs a measured budget; Tier 3 is never ready', () => {
    const roster = buildCapabilityRoster({ probe: passed, workerBudget, now: CALIBRATED_AT });
    expect(roster.get('tempo')?.status).toBe('ready');
    expect(roster.get('time_stretch')?.status).toBe('unsupported_here');
    expect(roster.list().filter((record) => record.tier === 3).every((record) => record.status === 'unsupported_here')).toBe(true);
  });
});

