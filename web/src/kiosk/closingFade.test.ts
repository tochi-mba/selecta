import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSING_FADE_S, exactClosing } from './controller';
import { createPlayer } from './player';

describe('the closing fade (ADR-0444)', () => {
  it('starts an exact close 20 s before the closing time and leaves natural closes alone', () => {
    expect(exactClosing('exact', 1_000, 975)).toBeNull();
    expect(exactClosing('exact', 1_000, 985)).toBe(15);
    expect(exactClosing('natural', 1_000, 999)).toBeNull();
    expect(exactClosing('exact', null, 999)).toBeNull();
    expect(CLOSING_FADE_S).toBe(20);
  });
});

describe('the player stops with the fade it is given', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps playing through a 20 s closing fade and stops after it', async () => {
    const elements: { currentTime: number; play: () => Promise<void>; pause: () => void; volume: number; src: string; preload: string; paused: boolean; ended: boolean; duration: number }[] = [];
    const createAudio = () => {
      const el = { currentTime: 0, play: async () => { el.paused = false; }, pause: () => { el.paused = true; }, volume: 1, src: '', preload: '', paused: true, ended: false, duration: 200 };
      elements.push(el);
      return el as unknown as HTMLAudioElement;
    };
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    const player = createPlayer({ now: () => 1_030, saved: () => true, blob: async () => new Blob(['x']), createAudio, context: null });
    player.setSegments([{ id: 'a', key: 'k', kind: 'song', starts_at: 1_000, duration_s: 200, bytes: 1, sha256: 'x' } as never]);
    player.start(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.useFakeTimers();
    player.stop(CLOSING_FADE_S);
    vi.advanceTimersByTime(19_000);
    expect(elements.some((el) => !el.paused)).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(elements.every((el) => el.paused)).toBe(true);
  });
});
