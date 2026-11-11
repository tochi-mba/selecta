import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioOwner, connectMainPlayer, releaseAudio, stopPreviewsOnly, takeAudio, usePreview } from './focus';

/* T0112 (ADR-0007): the audio-focus edges. A/B never overlap, rapid preview
 * switching settles on the last one, a failed load gives the sound back,
 * a suspended or refusing context never throws, and another tab taking the
 * sound is heard here. Browser-level coverage is in e2e/listen.e2e.ts. */

function mainPlayer(playing = true) {
  const state = { playing };
  return {
    state,
    isPlaying: () => state.playing,
    pause: vi.fn(() => { state.playing = false; }),
    resume: vi.fn(() => { state.playing = true; }),
  };
}

let playing = 0;
beforeEach(() => {
  playing = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => { playing += 1; });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { playing = Math.max(0, playing - 1); });
});

afterEach(() => {
  stopPreviewsOnly();
  connectMainPlayer(null);
  vi.restoreAllMocks();
});

describe('T0112 A/B non-overlap', () => {
  it('taking the sound for B stops A first, and only one owner exists at any moment', () => {
    const order: string[] = [];
    takeAudio({ id: 'a', label: 'A', stop: () => order.push('stop a') });
    order.push('a playing');
    takeAudio({ id: 'b', label: 'B', stop: () => order.push('stop b') });
    order.push('b playing');
    expect(order).toEqual(['a playing', 'stop a', 'b playing']);
    expect(audioOwner()?.id).toBe('b');
  });
});

describe('T0112 rapid preview switching', () => {
  it('twenty fast switches leave exactly the last preview playing and the mix waiting', async () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    const hooks = [renderHook(() => usePreview()), renderHook(() => usePreview()), renderHook(() => usePreview())];
    for (let press = 0; press < 20; press += 1) {
      const hook = hooks[press % hooks.length];
      act(() => hook.result.current.play(`clip-${press}`, `/clip/${press}`));
    }
    const last = hooks[19 % hooks.length].result.current;
    expect(last.playing).toBe('clip-19');
    expect(hooks.filter((hook) => hook.result.current.playing).length).toBe(1);
    expect(main.pause).toHaveBeenCalledTimes(1);
    expect(main.resume).not.toHaveBeenCalled();
    act(() => last.stop());
    await vi.waitFor(() => expect(main.resume).toHaveBeenCalledTimes(1));
  });

  it('an older play() rejecting late (AbortError) never brings the mix in under the newer clip', async () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    let rejectFirst: (error: Error) => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () => new Promise<void>((_, reject) => { rejectFirst = reject; }),
    );
    const { result } = renderHook(() => usePreview());
    act(() => result.current.play('one', '/one'));
    act(() => result.current.play('two', '/two'));
    await act(async () => { rejectFirst(Object.assign(new Error('replaced'), { name: 'AbortError' })); });
    expect(result.current.playing).toBe('two');
    expect(result.current.problem).toBe('');
    expect(main.resume).not.toHaveBeenCalled();
  });
});

describe('T0112 failed load', () => {
  it('a clip that errors while loading says so and gives the sound back to the mix', async () => {
    const main = mainPlayer();
    connectMainPlayer(main);
    const { result } = renderHook(() => usePreview());
    act(() => result.current.play('one', '/missing'));
    const audio = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLAudioElement;
    act(() => { audio.onerror?.(new Event('error')); });
    expect(result.current.problem).toMatch(/couldn’t be played/);
    expect(result.current.playing).toBe('');
    expect(audioOwner()).toBeNull();
    await vi.waitFor(() => expect(main.resume).toHaveBeenCalledTimes(1));
  });
});

describe('T0112 suspended context', () => {
  it('a slow suspension finishing after the preview ended still resumes once, not before', async () => {
    let finishPause: () => void = () => {};
    const main = mainPlayer();
    main.pause.mockImplementation(() => new Promise<void>((done) => { finishPause = () => { main.state.playing = false; done(); }; }) as never);
    connectMainPlayer(main);
    takeAudio({ id: 'p', label: 'Preview', stop: () => {} });
    releaseAudio('p');
    await Promise.resolve();
    expect(main.resume).not.toHaveBeenCalled();
    finishPause();
    await vi.waitFor(() => expect(main.resume).toHaveBeenCalledTimes(1));
  });

  it('a context that refuses to resume leaves the mix paused without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const main = mainPlayer();
    main.resume.mockImplementation(() => Promise.reject(new Error('NotAllowedError')) as never);
    connectMainPlayer(main);
    takeAudio({ id: 'p', label: 'Preview', stop: () => {} });
    releaseAudio('p');
    await vi.waitFor(() => expect(main.resume).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 10));
    window.removeEventListener('unhandledrejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(main.state.playing).toBe(false);
  });
});

describe('T0112 multi-tab ownership', () => {
  it('taking the sound tells other tabs, and another tab playing is heard here', async () => {
    const sent: unknown[] = [];
    const listeners: ((event: MessageEvent) => void)[] = [];
    class FakeChannel {
      constructor(readonly name: string) {}
      postMessage(data: unknown) { sent.push(data); }
      addEventListener(_: string, listen: (event: MessageEvent) => void) { listeners.push(listen); }
      removeEventListener() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.resetModules();
    const focus = await import('./focus');
    const tabs = await import('../state/tabs');
    const heard = vi.fn();
    const stopListening = tabs.whenAnotherTabPlays(heard);
    focus.takeAudio({ id: 'p', label: 'Preview', stop: () => {} });
    expect(sent).toHaveLength(1);
    const mine = (sent[0] as { playing: string }).playing;
    for (const listen of listeners) listen(new MessageEvent('message', { data: { playing: mine } }));
    expect(heard).not.toHaveBeenCalled(); // our own message is not another tab
    for (const listen of listeners) listen(new MessageEvent('message', { data: { playing: 'other-tab' } }));
    expect(heard).toHaveBeenCalledTimes(1);
    stopListening();
    focus.stopPreviewsOnly();
    vi.unstubAllGlobals();
  });
});
