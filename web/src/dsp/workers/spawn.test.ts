import { describe, expect, it } from 'vitest';
import { analyseInWorker, transferable } from './spawn';

/** Just enough Worker to see what was posted and answer it. */
class FakeWorker extends EventTarget {
  readonly sent: { message: unknown; transfer: Transferable[] }[] = [];
  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.sent.push({ message, transfer });
  }
  answer(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

describe('moving PCM to the analysis worker safely', () => {
  it('transfers a whole, owned array without copying it', () => {
    const pcm = new Float32Array(16);
    const sent = transferable(pcm, true);
    expect(sent.pcm).toBe(pcm);
    expect(sent.transfer).toEqual([pcm.buffer]);
  });

  it('copies a view into a larger buffer, so its neighbours are never detached', () => {
    const backing = new Float32Array(32);
    const view = backing.subarray(8, 24);
    const sent = transferable(view, true);
    expect(sent.pcm).not.toBe(view);
    expect(sent.pcm.buffer).not.toBe(backing.buffer);
    expect(sent.pcm.length).toBe(16);
  });

  it('copies by default, because an AudioBuffer channel belongs to the playing song', () => {
    const channel = new Float32Array([0.1, 0.2, 0.3]);
    const sent = transferable(channel, false);
    expect(sent.pcm).not.toBe(channel);
    expect(Array.from(sent.pcm)).toEqual(Array.from(channel));
    expect(sent.transfer).toEqual([sent.pcm.buffer]);
  });

  it('posts the safe array and settles on its own answer only', async () => {
    const worker = new FakeWorker();
    const channel = new Float32Array(64);
    const asked = analyseInWorker(worker as unknown as Worker, channel, 44100, ['tempo']);
    const { message, transfer } = worker.sent[0] as { message: { id: number; pcm: Float32Array }; transfer: Transferable[] };
    expect(message.pcm).not.toBe(channel); // not owned: copied, the caller's array stays usable
    expect(transfer).toEqual([message.pcm.buffer]);
    worker.answer({ id: message.id + 1000 }); // someone else's result
    worker.answer({ id: message.id, onsetTimes: [] });
    await expect(asked).resolves.toMatchObject({ id: message.id });
  });

  it('rejects when the result cannot be read, instead of waiting forever', async () => {
    const worker = new FakeWorker();
    const asked = analyseInWorker(worker as unknown as Worker, new Float32Array(8), 44100);
    worker.dispatchEvent(new MessageEvent('messageerror'));
    await expect(asked).rejects.toThrow(/could not be read/);
  });
});
