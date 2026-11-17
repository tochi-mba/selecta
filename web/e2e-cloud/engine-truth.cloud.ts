import { expect, test } from '@playwright/test';
import { listener, signedIn } from './cloud';

// Gate 2 seed (BF-0466-03, docs/verification/bf-gate-register.md): browser engine truth. The
// register's gate 2 demands the ADR-0457 probe running real, unmocked worklet DSP in Chromium,
// Firefox AND WebKit CI engines with recorded numbers. This spec is the harness for that: it
// loads the cloud app signed in, runs a worklet probe in the page, and records
// { engine, sampleRate, misses } to the test report.
//
// Until web/src/engine/probe.ts ships (BF-0457-02, BF-0460-01) the app bundle exposes no probe,
// so this spec drives the page directly: it creates an AudioContext and loads a probe worklet
// from an inline processor (via a Blob URL) that counts its own process() calls and scheduling
// gaps. Once the real probe exists, replace the inline processor with the app's own probe
// through the bundle, keeping the tripwire below.
//
// The anti-mock tripwire: the worklet must GENUINELY have processed. We sample its process()
// counter twice and require the second reading to be larger - a stub, a mocked AudioContext or
// a suspended graph fails that, by design. A synthetic pass here still never flips gate 2 by
// itself: the register's row needs CI runs on all three engines with artifacts, and this cloud
// suite currently runs on the Edge channel only (web/playwright.cloud.config.ts), so a
// three-engine project config must pick this spec up before the row can move.
//
// CI audio is muted by necessity; per ADR-0466 no muted test may claim anything about sound.
// This spec asserts processing and scheduling only.

const PROCESSOR = `
class BfEngineTruthProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.calls = 0;
    this.misses = 0;
    this.lastFrame = -1;
    this.port.onmessage = () => {
      this.port.postMessage({ calls: this.calls, misses: this.misses, frame: currentFrame });
    };
  }
  process(inputs, outputs) {
    const output = outputs[0];
    for (const channel of output) {
      for (let i = 0; i < channel.length; i++) {
        // A real, tiny signal so the graph genuinely renders; CI runs muted regardless.
        channel[i] = Math.sin((currentFrame + i) / sampleRate) * 1e-4;
      }
    }
    // Consecutive process() calls each cover one 128-frame quantum; a larger jump in
    // currentFrame means the renderer skipped time: a scheduling miss.
    if (this.lastFrame >= 0 && currentFrame - this.lastFrame > 128) this.misses += 1;
    this.lastFrame = currentFrame;
    this.calls += 1;
    return true;
  }
}
registerProcessor('bf-engine-truth-probe', BfEngineTruthProbe);
`;

type Count = { calls: number; misses: number; frame: number };

test('the engine probe worklet genuinely processes audio quanta, with recorded numbers', async ({ page, request }, testInfo) => {
  await signedIn(page, request, listener('engine-truth'));

  const probed = await page.evaluate(async (source) => {
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, 'bf-engine-truth-probe');
    const gain = new GainNode(context, { gain: 0.0001 });
    node.connect(gain).connect(context.destination);
    await context.resume();
    const sample = () =>
      new Promise<{ calls: number; misses: number; frame: number }>((resolve) => {
        node.port.onmessage = (event) => resolve(event.data);
        node.port.postMessage('report');
      });
    await new Promise((settle) => setTimeout(settle, 500));
    const first = await sample();
    await new Promise((settle) => setTimeout(settle, 300));
    const second = await sample();
    const report = {
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency ?? null,
      state: context.state,
      first,
      second,
    };
    await context.close();
    return report;
  }, PROCESSOR);

  // Tripwire: the worklet really ran, and kept running between the two samples. A mock that
  // fakes a counter once cannot fake forward progress of currentFrame-backed quanta.
  expect(probed.state).toBe('running');
  expect((probed.first as Count).calls).toBeGreaterThan(0);
  expect((probed.second as Count).calls).toBeGreaterThan((probed.first as Count).calls);
  expect((probed.second as Count).frame).toBeGreaterThan((probed.first as Count).frame);
  expect(probed.sampleRate).toBeGreaterThan(0);

  // The recorded numbers the gate asks for. The engine name must eventually be one of
  // chromium, firefox and webkit per the register; today's cloud project is Edge (Chromium).
  const recorded = {
    engine: testInfo.project.name || 'chromium (msedge channel)',
    sampleRate: probed.sampleRate,
    misses: (probed.second as Count).misses,
    calls: (probed.second as Count).calls,
    baseLatency: probed.baseLatency,
  };
  testInfo.annotations.push({ type: 'engine-truth', description: JSON.stringify(recorded) });
  await testInfo.attach('engine-truth.json', {
    body: JSON.stringify(recorded, null, 2),
    contentType: 'application/json',
  });
});
