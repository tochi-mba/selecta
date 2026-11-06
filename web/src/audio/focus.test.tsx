import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioOwner, connectMainPlayer, mainPlayerTouched, releaseAudio, stopPreviewsOnly, takeAudio, usePreview } from './focus';

function mainPlayer(playing = true) {
  const state = { playing };
  return {
    state,
    isPlaying: () => state.playing,
    pause: vi.fn(() => { state.playing = false; }),
    resume: vi.fn(() => { state.playing = true; }),
  };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  stopPreviewsOnly();
  connectMainPlayer(null);
});

describe('one sound at a time', () => {
  it('starting a preview pauses the mix, and it carries on afterwards', () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    takeAudio({ id: 'a', label: 'A', stop: vi.fn() });
    expect(main.pause).toHaveBeenCalled();
    releaseAudio('a');
    expect(main.resume).toHaveBeenCalled();
  });

  it('a preview doesn’t start the mix if it wasn’t playing', () => {
    const main = mainPlayer(false);
    connectMainPlayer(main);
    takeAudio({ id: 'a', label: 'A', stop: vi.fn() });
    releaseAudio('a');
    expect(main.pause).not.toHaveBeenCalled();
    expect(main.resume).not.toHaveBeenCalled();
  });

  it('never restarts the mix after someone has pressed something themselves', () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    takeAudio({ id: 'a', label: 'A', stop: vi.fn() });
    mainPlayerTouched();
    releaseAudio('a');
    expect(main.resume).not.toHaveBeenCalled();
  });

  it('a new preview stops the old one, and the mix waits for the last of them', () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    const stopFirst = vi.fn();
    takeAudio({ id: 'a', label: 'A', stop: stopFirst });
    takeAudio({ id: 'b', label: 'B', stop: vi.fn() });
    expect(stopFirst).toHaveBeenCalled();
    expect(audioOwner()?.id).toBe('b');
    expect(main.resume).not.toHaveBeenCalled();
    releaseAudio('b');
    expect(main.resume).toHaveBeenCalledOnce();
  });

  it('something that lost the sound can’t let go of someone else’s', () => {
    takeAudio({ id: 'a', label: 'A', stop: vi.fn() });
    takeAudio({ id: 'b', label: 'B', stop: vi.fn() });
    releaseAudio('a');
    expect(audioOwner()?.id).toBe('b');
  });

  it('can stop previews and leave the mix paused', () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    const stop = vi.fn();
    takeAudio({ id: 'a', label: 'A', stop });
    stopPreviewsOnly();
    expect(stop).toHaveBeenCalled();
    expect(main.resume).not.toHaveBeenCalled();
    expect(audioOwner()).toBeNull();
  });
});

describe('a preview on a page', () => {
  it('plays, stops, and toggles', () => {
    const { result } = renderHook(() => usePreview());
    act(() => result.current.play('one', '/one'));
    expect(result.current.playing).toBe('one');
    act(() => result.current.toggle('one', '/one'));
    expect(result.current.playing).toBe('');
  });

  it('two can’t play at once', () => {
    const first = renderHook(() => usePreview());
    const second = renderHook(() => usePreview());
    act(() => first.result.current.play('one', '/one'));
    act(() => second.result.current.play('two', '/two'));
    expect(first.result.current.playing).toBe('');
    expect(second.result.current.playing).toBe('two');
  });

  it('leaving the page lets the sound go, and the mix carries on', () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    const { result, unmount } = renderHook(() => usePreview());
    act(() => result.current.play('one', '/one'));
    unmount();
    expect(audioOwner()).toBeNull();
    expect(main.resume).toHaveBeenCalled();
  });

  it('says so if it can’t play, and gives the sound back', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('no'));
    const main = mainPlayer();
    connectMainPlayer(main);
    const { result } = renderHook(() => usePreview());
    await act(async () => { result.current.play('one', '/one'); });
    expect(result.current.problem).toMatch(/couldn’t be played/);
    expect(result.current.playing).toBe('');
    expect(main.resume).toHaveBeenCalled();
  });
});
