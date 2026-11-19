import { describe, expect, it } from 'vitest';
import { peaksFrom } from './waveform';

const pcm = (values: number[][]) => ({
  numberOfChannels: values.length,
  length: values[0].length,
  getChannelData: (channel: number) => Float32Array.from(values[channel]),
});

describe('the browser waveform', () => {
  it('is the RMS envelope per bin, the loudest bin scaled to 1, as the Python engine stores it', () => {
    const quiet = Array(100).fill(0.1);
    const loud = Array(100).fill(0.5);
    expect(peaksFrom(pcm([[...quiet, ...loud]]), 2)).toEqual([0.2, 1]);
  });

  it('averages channels, never asks for more bins than samples, and a silent file is flat', () => {
    expect(peaksFrom(pcm([[1, 1], [0, 0]]), 2)).toEqual([1, 1]);
    expect(peaksFrom(pcm([[0.5, 0.5, 0.5]]), 400)).toHaveLength(3);
    expect(peaksFrom(pcm([[0, 0, 0, 0]]), 2)).toEqual([0, 0]);
  });
});
