import { describe, expect, it, vi } from 'vitest';
import { peaksFrom, peaksInSlices, type PcmChannels } from '../dsp/waveform';
import { waveformBook, type WaveformDeps } from './sharedWaveforms';

// T-20261125-2e79: the next song's waveform comes from the audio the engine decoded to play it, so
// the live blend has it before the hand-over and the file is never decoded twice for the picture.

const pcm = (length: number): PcmChannels => {
  const left = Float32Array.from({ length }, (_, index) => Math.sin(index / 50) * (index / length));
  const right = Float32Array.from({ length }, (_, index) => Math.cos(index / 70) * 0.5);
  return { numberOfChannels: 2, length, getChannelData: (channel) => (channel === 0 ? left : right) };
};
const rest = () => Promise.resolve();
const deps = (): WaveformDeps & { resolve: ReturnType<typeof vi.fn> } => ({
  resolve: vi.fn(async () => null),
  openStore: async () => { throw new Error('not asked'); },
  shared: false,
  decode: async () => [1],
});

describe('peaks in slices', () => {
  it('are the same peaks, with turns for the page in between and before the first slice', async () => {
    const audio = pcm(100_000);
    const turns = vi.fn(rest);
    expect(await peaksInSlices(audio, turns, 400, 10_000)).toEqual(peaksFrom(audio, 400));
    expect(turns.mock.calls.length).toBeGreaterThan(5);
  });
});

describe('the waveform book', () => {
  it('keeps the peaks of a song the engine decoded, and never reads its file for them', async () => {
    const book = waveformBook(rest);
    const audio = pcm(50_000);
    book.fromDecoded(7, audio);
    const asked = deps();
    expect(await book.of(7, asked)).toEqual(peaksFrom(audio));
    expect(asked.resolve).not.toHaveBeenCalled();
  });

  it('starts no work while the engine is still handing the audio over', () => {
    const book = waveformBook(() => new Promise(() => {}));
    const read = vi.fn(() => new Float32Array(10));
    book.fromDecoded(7, { numberOfChannels: 1, length: 10, getChannelData: read });
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps what it already has rather than drawing the same song again', async () => {
    const book = waveformBook(rest);
    const first = pcm(20_000);
    book.fromDecoded(7, first);
    const again = vi.fn(() => new Float32Array(20_000));
    book.fromDecoded(7, { numberOfChannels: 1, length: 20_000, getChannelData: again });
    expect(await book.of(7, deps())).toEqual(peaksFrom(first));
    expect(again).not.toHaveBeenCalled();
  });

  it('reads the file of a song the engine has not decoded, and asks again after a miss', async () => {
    const book = waveformBook(rest);
    const asked = deps();
    expect(await book.of(3, asked)).toBeNull();
    await Promise.resolve();
    expect(await book.of(3, asked)).toBeNull();
    expect(asked.resolve).toHaveBeenCalledTimes(2);
  });
});
