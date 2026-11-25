import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handoffsHeard, handoffWatcher, lastHandoffHeard, noteHandoffHeard, onHandoffHeard, resetHandoffHeard } from './handoffHeard';

// T-20261125-ebda: a hand-over counts as heard only once it has played to its end here, on screen.

const playing = (position: number, inSeam: boolean) => ({ phase: 'playing', position, inSeam });

describe('the hand-over heard signal', () => {
  beforeEach(() => resetHandoffHeard());

  it('reports a Cloud hand-over once, when the next song is current and the hand-over is over', () => {
    const report = vi.fn();
    const watch = handoffWatcher(report);
    watch(playing(0, false), true, 1);
    watch(playing(0, true), true, 2);
    watch(playing(0, true), true, 3);
    expect(report).not.toHaveBeenCalled();
    watch(playing(1, false), true, 4);
    watch(playing(1, false), true, 5);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ fromIndex: 0, intoIndex: 1 }));
  });

  it('follows local mode, where the next song is current during the hand-over tail', () => {
    const report = vi.fn();
    const watch = handoffWatcher(report);
    watch({ ...playing(2, true), songId: 30 }, true, 1);
    watch({ ...playing(3, true), songId: 40, seamKey: 'k' }, true, 2);
    watch({ ...playing(3, false), songId: 40, seamKey: 'k' }, true, 3);
    expect(report).toHaveBeenCalledWith({ fromIndex: 2, intoIndex: 3, fromSongId: 30, intoSongId: 40, seamKey: 'k' });
  });

  it('says nothing for a hand-over paused, jumped out of, or off screen at any point', () => {
    const report = vi.fn();
    const watch = handoffWatcher(report);
    watch(playing(0, true), true, 1);
    watch({ phase: 'paused', position: 0, inSeam: true }, true, 2);
    watch(playing(1, false), true, 3);
    watch(playing(1, true), true, 4);
    watch(playing(5, false), true, 5);
    watch(playing(5, true), true, 6);
    watch(playing(5, true), false, 7);
    watch(playing(6, false), true, 8);
    watch(playing(6, true), false, 9);
    watch(playing(7, false), true, 10);
    expect(report).not.toHaveBeenCalled();
  });

  it('passes each one to whoever listens and remembers the latest', () => {
    const listener = vi.fn();
    const stop = onHandoffHeard(listener);
    noteHandoffHeard({ fromIndex: 0, intoIndex: 1 });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ fromIndex: 0, intoIndex: 1 }));
    expect(lastHandoffHeard()).toMatchObject({ fromIndex: 0, intoIndex: 1 });
    expect(handoffsHeard()).toBe(1);
    stop();
    noteHandoffHeard({ fromIndex: 1, intoIndex: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
