import { expect, test } from '@playwright/test';
import { limiterProcessorOptions } from '../src/engine/limiter';
import { LIMITER_PROCESSOR, LIMITER_PROCESSOR_SOURCE } from '../src/engine/worklet/limiterProcessor';
import { PROBE_PROCESSOR, PROBE_PROCESSOR_SOURCE } from '../src/engine/worklet/probeProcessor';
import { listener, signedIn } from './cloud';

// Gate 2 (BF-0466-03, docs/verification/bf-gate-register.md): browser engine truth. The
// register's gate 2 demands the ADR-0457 probe running real, unmocked worklet DSP in Chromium,
// Firefox AND WebKit with recorded numbers. playwright.engine-truth.config.ts runs this spec in
// exactly those three projects (pnpm e2e:engine-truth).
//
// The REAL worklets: the page loads the exact processor source text the engine ships
// (engine/worklet/probeProcessor.ts and limiterProcessor.ts, the same strings probe.ts and
// limiter.ts hand to addModule), with the limiter's coefficients from dsp/limiter.ts. Nothing
// here is a stand-in processor.
//
// The anti-mock tripwire: the limiter's process() counters are sampled twice and the second
// reading must be larger in both blocks and frames; the probe must report real quanta at the
// context's sample rate; and the limiter must have pulled a +12 dB oscillator under its
// ceiling, which a stub, a mocked AudioContext or a suspended graph cannot do.
//
// CI audio is muted or silent by necessity; per ADR-0466 no muted test may claim anything about
// sound. Every assertion here is about processing and scheduling only, never audibility.

type ProbeReport = { type: 'probe-report'; blocks: number; misses: number; sampleRate: number };
type LimiterStats = {
  type: 'limiter-stats';
  blocks: number;
  frames: number;
  frame: number;
  sampleRate: number;
  peakIn: number;
  peakOut: number;
  delaySamples: number;
};
type Probed = {
  state: string;
  sampleRate: number;
  baseLatency: number | null;
  probe: ProbeReport | null;
  first: LimiterStats;
  second: LimiterStats;
  ceilingLinear: number;
};

test('the shipped probe and limiter worklets genuinely process audio, with recorded numbers', async ({ page, request }, testInfo) => {
  await signedIn(page, request, listener('engine-truth'));

  // Make the context inside a real click, so every engine's autoplay rule is met honestly.
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'engine-truth-start';
    button.textContent = 'start';
    button.addEventListener('click', () => {
      const scope = window as unknown as { engineTruth?: AudioContext };
      scope.engineTruth = new AudioContext();
      void scope.engineTruth.resume();
    });
    document.body.append(button);
  });
  await page.click('#engine-truth-start');

  const sampleRate = await page.evaluate(() => (window as unknown as { engineTruth: AudioContext }).engineTruth.sampleRate);
  const processorOptions = limiterProcessorOptions(sampleRate);

  const probed = await page.evaluate(async (input): Promise<Probed> => {
    const context = (window as unknown as { engineTruth: AudioContext }).engineTruth;
    const load = async (source: string) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    await load(input.probeSource);
    await load(input.limiterSource);
    if (context.state !== 'running') await context.resume();
    const mute = new GainNode(context, { gain: 0 });
    mute.connect(context.destination);

    // The probe processor, exactly as probe.ts runs it.
    const probeNode = new AudioWorkletNode(context, input.probeName);
    probeNode.connect(mute);
    const probe = await new Promise<ProbeReport | null>((settle) => {
      const wait = setTimeout(() => settle(null), 5000);
      probeNode.port.onmessage = (event) => {
        if (event.data?.type !== 'probe-report') return;
        clearTimeout(wait);
        settle(event.data as ProbeReport);
      };
    });
    probeNode.disconnect();

    // The limiter processor, exactly as limiter.ts installs it, fed a +12 dB oscillator.
    const limiter = new AudioWorkletNode(context, input.limiterName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: input.processorOptions,
    });
    const tone = new OscillatorNode(context, { frequency: 997 });
    const loud = new GainNode(context, { gain: 4 });
    tone.connect(loud).connect(limiter).connect(mute);
    tone.start();
    const sample = () => new Promise<LimiterStats>((settle) => {
      limiter.port.onmessage = (event) => {
        if (event.data?.type === 'limiter-stats') settle(event.data as LimiterStats);
      };
      limiter.port.postMessage({ type: 'stats' });
    });
    await new Promise((settle) => setTimeout(settle, 500));
    const first = await sample();
    await new Promise((settle) => setTimeout(settle, 400));
    const second = await sample();
    tone.stop();
    const report: Probed = {
      state: context.state,
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency ?? null,
      probe,
      first,
      second,
      ceilingLinear: input.processorOptions.ceilingLinear,
    };
    await context.close();
    return report;
  }, {
    probeSource: PROBE_PROCESSOR_SOURCE,
    limiterSource: LIMITER_PROCESSOR_SOURCE,
    probeName: PROBE_PROCESSOR,
    limiterName: LIMITER_PROCESSOR,
    processorOptions,
  });

  // The probe: real quanta at the context's own rate.
  expect(probed.state).toBe('running');
  expect(probed.probe).not.toBeNull();
  expect(probed.probe!.blocks).toBeGreaterThanOrEqual(32);
  expect(probed.probe!.sampleRate).toBe(probed.sampleRate);

  // Tripwire: the limiter really ran, and kept running between the two samples.
  expect(probed.first.blocks).toBeGreaterThan(0);
  expect(probed.second.blocks).toBeGreaterThan(probed.first.blocks);
  expect(probed.second.frames).toBeGreaterThan(probed.first.frames);
  expect(probed.second.frame).toBeGreaterThan(probed.first.frame);
  expect(probed.second.sampleRate).toBe(probed.sampleRate);

  // Processing, not sound: the DSP pulled a peak near 4.0 under its ceiling.
  expect(probed.second.peakIn).toBeGreaterThan(3);
  expect(probed.second.peakOut).toBeGreaterThan(0);
  expect(probed.second.peakOut).toBeLessThanOrEqual(probed.ceilingLinear + 1e-6);

  const recorded = {
    engine: testInfo.project.name,
    sampleRate: probed.sampleRate,
    probeBlocks: probed.probe!.blocks,
    probeMisses: probed.probe!.misses,
    limiterBlocks: probed.second.blocks,
    limiterDelaySamples: probed.second.delaySamples,
    limiterPeakIn: probed.second.peakIn,
    limiterPeakOut: probed.second.peakOut,
    baseLatency: probed.baseLatency,
  };
  testInfo.annotations.push({ type: 'engine-truth', description: JSON.stringify(recorded) });
  await testInfo.attach('engine-truth.json', {
    body: JSON.stringify(recorded, null, 2),
    contentType: 'application/json',
  });
});
