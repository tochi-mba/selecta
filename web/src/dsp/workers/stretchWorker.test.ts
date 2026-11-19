import { describe, expect, it } from 'vitest';
import { rampSourceSeconds } from '../stretchLimits';
import { stretchInWorker } from './stretchSpawn';
import { stretchRequest, trustedStretchRequest, type StretchRequest } from './stretchWorker';

const RATE = 44100;
const tone = (seconds: number) => {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) out[index] = 0.4 * Math.sin((2 * Math.PI * 330 * index) / RATE);
  return out;
};

/** Just enough Worker to see what was posted and answer it. */
class FakeWorker extends EventTarget {
  readonly sent: { message: StretchRequest; transfer: Transferable[] }[] = [];
  postMessage(message: StretchRequest, transfer: Transferable[] = []) {
    this.sent.push({ message, transfer });
  }
  answer(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

describe('the stretch worker', () => {
  it('stretches every channel along the ramp, in the code the worker runs', () => {
    const ramp = { ratio: 0.95, holdSeconds: 1, rampSeconds: 1 };
    const response = stretchRequest({ id: 3, sampleRate: RATE, channels: [tone(3), tone(3)], ramp });
    expect(response.id).toBe(3);
    expect(response.error).toBeUndefined();
    const [left, right] = response.channels!;
    expect(left.length).toBe(right.length);
    expect(Math.abs(rampSourceSeconds(ramp, left.length / RATE) - 3) * RATE).toBeLessThan(2);
  });

  it('answers a refusal as an error, never as audio', () => {
    const response = stretchRequest({ id: 4, sampleRate: RATE, channels: [tone(1)], ramp: { ratio: 1.2, holdSeconds: 1, rampSeconds: 0 } });
    expect(response.channels).toBeUndefined();
    expect(response.error).toMatch(/8 percent/);
  });

  it('only trusts a well-formed request', () => {
    const ok = { id: 1, sampleRate: RATE, channels: [new Float32Array(4)], ramp: { ratio: 1, holdSeconds: 0, rampSeconds: 0 } };
    const event = (data: unknown) => new MessageEvent('message', { data }) as MessageEvent<StretchRequest>;
    expect(trustedStretchRequest(event(ok))).toBe(ok);
    expect(trustedStretchRequest(event({ ...ok, channels: [] }))).toBeNull();
    expect(trustedStretchRequest(event({ ...ok, channels: [[0, 1]] }))).toBeNull();
    expect(trustedStretchRequest(event({ ...ok, ramp: { ratio: Number.NaN, holdSeconds: 0, rampSeconds: 0 } }))).toBeNull();
    expect(trustedStretchRequest(event('stretch please'))).toBeNull();
  });
});

describe('moving a stretch to the worker', () => {
  it('copies channels the caller does not own, transfers owned ones, and settles on its own answer', async () => {
    const worker = new FakeWorker();
    const owned = new Float32Array(8);
    const playing = new Float32Array(8);
    const ramp = { ratio: 1.02, holdSeconds: 0.1, rampSeconds: 0.1 };
    const asked = stretchInWorker(worker as unknown as Worker, [owned], RATE, ramp, { owned: true });
    expect(worker.sent[0].message.channels[0]).toBe(owned);
    expect(worker.sent[0].transfer).toEqual([owned.buffer]);
    void stretchInWorker(worker as unknown as Worker, [playing], RATE, ramp);
    expect(worker.sent[1].message.channels[0]).not.toBe(playing);
    const out = new Float32Array(7);
    worker.answer({ id: worker.sent[1].message.id, channels: [new Float32Array(1)] });
    worker.answer({ id: worker.sent[0].message.id, channels: [out] });
    await expect(asked).resolves.toEqual([out]);
  });

  it('rejects a worker error, a wrong shape and a stuck worker, so the seam can go without', async () => {
    const worker = new FakeWorker();
    const ramp = { ratio: 1, holdSeconds: 0, rampSeconds: 0 };
    const failed = stretchInWorker(worker as unknown as Worker, [new Float32Array(4)], RATE, ramp);
    worker.answer({ id: worker.sent[0].message.id, error: 'a tempo change of 20.0 percent is outside the 8 percent stretch limit' });
    await expect(failed).rejects.toThrow(/8 percent/);
    const shapeless = stretchInWorker(worker as unknown as Worker, [new Float32Array(4), new Float32Array(4)], RATE, ramp);
    worker.answer({ id: worker.sent[1].message.id, channels: [new Float32Array(4)] });
    await expect(shapeless).rejects.toThrow(/without the stretched audio/);
    const stuck = stretchInWorker(worker as unknown as Worker, [new Float32Array(4)], RATE, ramp, { timeoutMs: 5 });
    await expect(stuck).rejects.toThrow(/took longer than/);
  });
});
