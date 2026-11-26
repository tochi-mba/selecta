import { afterEach, describe, expect, it } from 'vitest';
import cloud from '../../../../src/selecta/flags/cloud.json' with { type: 'json' };
import { REGISTRY, setFlags } from '../../flags';
import { neededWindows, renderScript } from '../render/engine';
import { type GoldenSong, goldenProvider } from '../render/goldenSupport';
import { RENDER_IMPLEMENTATION } from '../render/ids';
import { scriptFromDict, writeSourceRef } from '../render/scriptJson';
import { wsolaStretcher } from '../render/warpStretch';
import { SeamRenderer } from './renderSpawn';
import { type RenderSeamRequest, type RenderSeamSource, renderSeam, trustedRenderRequest } from './renderWorker';

// The render worker's body and its page side (docs/engineering/device-render.md), with the
// worker double the other worker tests use. The script is the cut-on-one fixture: the shortest.

const files = import.meta.glob(['../golden/device-render/songs.json', '../golden/device-render/cut-on-one.json'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const songs = (JSON.parse(files['../golden/device-render/songs.json']) as { songs: GoldenSong[] }).songs;
const fixture = JSON.parse(files['../golden/device-render/cut-on-one.json']) as {
  script: Record<string, unknown>;
  port: { report: { checks: { name: string; passed: boolean }[] } };
};
const scriptText = JSON.stringify(fixture.script);

/** Only the windows the script reads, cut from the synthetic songs, as a page would send them. */
function windows(): RenderSeamSource[] {
  const provider = goldenProvider(songs);
  return neededWindows(scriptFromDict(fixture.script)).map(({ ref, from, to }) => {
    const whole = provider.samples(ref);
    return {
      ref: writeSourceRef(ref),
      channels: whole.channels.map((channel) => channel.slice(from, to)),
      offset: from,
      length: whole.channels[0].length,
    };
  });
}

const request = (overrides: Partial<RenderSeamRequest> = {}): RenderSeamRequest => ({
  id: 5,
  task: 'renderSeam',
  script: scriptText,
  sources: windows(),
  enabled: true,
  ...overrides,
});

/** Just enough Worker to see what was posted, answer it, and be ended. */
class FakeWorker extends EventTarget {
  readonly sent: { message: RenderSeamRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  postMessage(message: RenderSeamRequest, transfer: Transferable[] = []) {
    this.sent.push({ message, transfer });
  }
  answer(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => setFlags(null));

describe('the render worker body', () => {
  it('renders and audits from the windows alone, and moves the clip back', () => {
    const { response, transfer } = renderSeam(request());
    expect(response.status).toBe('ready');
    if (response.status !== 'ready') return;
    expect(response.implementation).toBe(`${RENDER_IMPLEMENTATION}+wsola-stretch-v1`);
    expect(response.sampleRate).toBe(44100);
    expect(transfer).toEqual(response.clip.map((channel) => channel.buffer));
    // the same clip as a render from the whole songs
    const whole = renderScript(scriptFromDict(fixture.script), goldenProvider(songs), wsolaStretcher);
    expect(whole.status).toBe('ready');
    if (whole.status !== 'ready') return;
    expect(response.clip[0]).toEqual(whole.audio[0]);
    expect(response.clip[1]).toEqual(whole.audio[1]);
    expect(response.report.checks.map((check) => [check.name, check.passed])).toEqual(fixture.port.report.checks.map((check) => [check.name, check.passed]));
    expect(response.facts.passed).toBe(response.report.checks.every((check) => check.passed));
  }, 60_000);

  it('refuses when the flag is off, without rendering', () => {
    const { response, transfer } = renderSeam(request({ enabled: false }));
    expect(response.status).toBe('off');
    expect(transfer).toEqual([]);
  });

  it('answers a missing source or a broken script as data', () => {
    const missing = renderSeam(request({ sources: windows().slice(1) }));
    expect(missing.response.status).toBe('error');
    expect(missing.response.status !== 'ready' && missing.response.reason).toMatch(/no audio was sent/);
    const broken = renderSeam(request({ script: JSON.stringify({ ...fixture.script, schema: 9 }) }));
    expect(broken.response.status).toBe('error');
    const short = windows();
    short[0] = { ...short[0], offset: short[0].offset + 44100 };
    expect(renderSeam(request({ sources: short })).response.status).toBe('error');
  });

  it('only trusts a well-formed request', () => {
    const ok = request();
    expect(trustedRenderRequest(ok)).toBe(ok);
    expect(trustedRenderRequest({ ...ok, task: 'analyse' })).toBeNull();
    expect(trustedRenderRequest({ ...ok, script: {} })).toBeNull();
    expect(trustedRenderRequest({ ...ok, sources: [{ ref: {}, channels: [[0, 1]], offset: 0 }] })).toBeNull();
    expect(trustedRenderRequest('render please')).toBeNull();
  });
});

describe('the page side of the render worker', () => {
  it('starts nothing while cloud.device_render is off', async () => {
    let spawned = 0;
    const renderer = new SeamRenderer(() => {
      spawned += 1;
      return new FakeWorker() as unknown as Worker;
    });
    setFlags({ 'cloud.device_render': false });
    await expect(renderer.render(scriptText, windows())).resolves.toMatchObject({ status: 'off' });
    setFlags(null);
    await expect(renderer.render(scriptText, windows())).resolves.toMatchObject({ status: 'off' });
    expect(spawned).toBe(0);
  });

  it('moves owned windows to the worker and settles on its own answer', async () => {
    setFlags({ 'cloud.device_render': true });
    const worker = new FakeWorker();
    const renderer = new SeamRenderer(() => worker as unknown as Worker);
    const sources = windows();
    const asked = renderer.render(scriptText, sources, { owned: true });
    const sent = worker.sent[0];
    expect(sent.message.enabled).toBe(true);
    expect(sent.message.sources[0].channels[0]).toBe(sources[0].channels[0]);
    expect(sent.transfer).toEqual(sources.flatMap((source) => source.channels.map((channel) => channel.buffer)));
    worker.answer({ id: sent.message.id + 1, status: 'error', implementation: 'x', reason: 'not mine' });
    worker.answer({ id: sent.message.id, status: 'off', implementation: 'x', reason: 'mine' });
    await expect(asked).resolves.toMatchObject({ reason: 'mine' });
  });

  it('ends the worker when a render is abandoned, and every render waiting on it', async () => {
    setFlags({ 'cloud.device_render': true });
    const workers: FakeWorker[] = [];
    const renderer = new SeamRenderer(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const skip = new AbortController();
    const first = renderer.render(scriptText, windows(), { signal: skip.signal });
    const second = renderer.render(scriptText, windows());
    skip.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(true);
    // the next render starts a fresh worker
    void renderer.render(scriptText, windows()).catch(() => undefined);
    expect(workers.length).toBe(2);
    renderer.end();
  });

  it('gives up on a render past its deadline', async () => {
    setFlags({ 'cloud.device_render': true });
    const worker = new FakeWorker();
    const renderer = new SeamRenderer(() => worker as unknown as Worker);
    await expect(renderer.render(scriptText, windows(), { timeoutMs: 5 })).rejects.toThrow(/deadline/);
    expect(worker.terminated).toBe(true);
  });
});

describe('the cloud.device_render flag', () => {
  it('is registered, off by default, and needs the device measurements', () => {
    expect(REGISTRY['cloud.device_render']).toBeDefined();
    const spec = (cloud.flags as unknown as Record<string, { default: boolean; requires?: string[]; modes?: string[] }>)['cloud.device_render'];
    expect(spec.default).toBe(false);
    expect(spec.requires).toContain('cloud.device_analysis');
    expect(spec.modes).toEqual(['cloud']);
  });
});
