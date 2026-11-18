import { expect, test } from '@playwright/test';
import { build } from 'vite';
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

/** Playwright's Windows WebKit build ships without Web Audio at all (no AudioContext), so
 * WebKit engine truth can only run where its build has it (Linux, as CI runs it). That one case
 * is skipped, with the reason recorded; anywhere else a missing AudioContext fails the gate. */
async function skipWithoutWebAudio(page: import('@playwright/test').Page, engine: string) {
  const present = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(!present && engine === 'webkit' && process.platform === 'win32', 'Playwright WebKit on Windows has no Web Audio; WebKit engine truth runs on Linux (CI).');
  expect(present, `${engine} has no AudioContext`).toBe(true);
}

test('the shipped probe and limiter worklets genuinely process audio, with recorded numbers', async ({ page, request }, testInfo) => {
  await signedIn(page, request, listener('engine-truth'));
  await skipWithoutWebAudio(page, testInfo.project.name);

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

// BF-0466-03: the application's own capability probe is the subject. engine/probe.ts (the
// exact module the browser player gates on, via e2e-cloud/engineProbeEntry.ts) is bundled and
// run in the page on each engine against its real AudioContext and AudioWorkletNode. A mocked
// or stubbed audio stack fails here: the constructors must be the browser's native ones, the
// probe must answer ok with real processed blocks at the context's own rate, and the same probe
// over a processor that never reports must refuse with its recorded reason.

let probeBundle = '';

test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: new URL('./engineProbeEntry.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), formats: ['iife'], name: 'SelectaProbe' },
    },
  });
  const outputs = (Array.isArray(built) ? built : [built]) as { output: { code?: string }[] }[];
  probeBundle = outputs[0].output.map((chunk) => chunk.code ?? '').join('\n');
  expect(probeBundle).toContain('probe-report');
});

type AppProbe = {
  native: { context: boolean; worklet: boolean };
  result: { ok: boolean; sampleRate?: number; schedulingMisses?: number; blocks?: number; reason?: string };
  contextRate: number;
  stubbed: { ok: boolean; reason?: string };
};

test('the application probe (engine/probe.ts) passes on this engine with real worklet processing', async ({ page, request }, testInfo) => {
  await signedIn(page, request, listener('engine-probe'));
  await skipWithoutWebAudio(page, testInfo.project.name);
  await page.addScriptTag({ content: probeBundle });
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'engine-probe-start';
    button.textContent = 'start';
    button.addEventListener('click', () => {
      const scope = window as unknown as { probeContext?: AudioContext; silentContext?: AudioContext };
      scope.probeContext = new AudioContext();
      void scope.probeContext.resume();
      scope.silentContext = new AudioContext();
      void scope.silentContext.resume();
    });
    document.body.append(button);
  });
  await page.click('#engine-probe-start');

  const probed = await page.evaluate(async (name): Promise<AppProbe> => {
    type Probe = { probeCapability: (context: AudioContext, options?: { waitMs?: number }) => Promise<AppProbe['result']> };
    const scope = window as unknown as { probeContext: AudioContext; silentContext: AudioContext; SelectaProbe: Probe };
    const native = (value: unknown) => typeof value === 'function' && /\[native code\]/.test(Function.prototype.toString.call(value));
    const context = scope.probeContext;
    const result = await scope.SelectaProbe.probeCapability(context, { waitMs: 5000 });
    const contextRate = context.sampleRate;
    await context.close();
    // Tripwire: the same probe over a processor that runs but never reports must refuse, with
    // its reason, so a pass above can only come from the real processor really processing.
    const silent = scope.silentContext;
    const stub = URL.createObjectURL(new Blob([`registerProcessor(${JSON.stringify(name)}, class extends AudioWorkletProcessor { process() { return true; } });`], { type: 'text/javascript' }));
    const stubbed = await scope.SelectaProbe.probeCapability(silent, { waitMs: 600, moduleUrl: stub } as never);
    URL.revokeObjectURL(stub);
    await silent.close();
    return { native: { context: native(AudioContext), worklet: native(AudioWorkletNode) }, result, contextRate, stubbed };
  }, PROBE_PROCESSOR);

  expect(probed.native).toEqual({ context: true, worklet: true });
  expect(probed.result.ok, probed.result.reason).toBe(true);
  expect(probed.result.blocks).toBeGreaterThanOrEqual(32);
  expect(probed.result.sampleRate).toBe(probed.contextRate);
  expect(probed.stubbed.ok).toBe(false);
  expect(probed.stubbed.reason).toMatch(/never processed audio/);

  const recorded = {
    engine: testInfo.project.name,
    subject: 'web/src/engine/probe.ts probeCapability',
    ok: probed.result.ok,
    sampleRate: probed.result.sampleRate,
    blocks: probed.result.blocks,
    schedulingMisses: probed.result.schedulingMisses,
  };
  testInfo.annotations.push({ type: 'engine-truth-probe', description: JSON.stringify(recorded) });
  await testInfo.attach('engine-truth-probe.json', { body: JSON.stringify(recorded, null, 2), contentType: 'application/json' });
});
