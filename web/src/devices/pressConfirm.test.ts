import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeWords } from './ChangedFromLine';
import { asConfirmed, awaitSpeaker, pressFailedWords, unansweredWords } from './pressConfirm';
import type { Api, SessionState } from './playbackWire';

// ADR-0475 G3 (68) and G70 with a fake speaker: the sender waits on the speaker's ack, says when
// it did not answer, and shows the session as it was; the speaker says what changed from where.

const session = (more: Partial<SessionState> = {}): SessionState => ({ mix_revision_id: null, song_index: 2, offset_ms: 1000, anchor_at: 10, state: 'playing', active_device_id: 'laptop', lease_expires_at: 99, seq: 7, ...more });

afterEach(() => { vi.useRealTimers(); });

describe('awaitSpeaker', () => {
  it('answers applied once the fake speaker acks the press', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const api = vi.fn(async () => { reads += 1; return { status: 'applied', ack_result: reads >= 3 ? 'applied' : null }; }) as unknown as Api;
    const outcome = awaitSpeaker(api, 'ws', 'phone', 'cmd-1', { limitMs: 5000, everyMs: 500 });
    await vi.advanceTimersByTimeAsync(1600);
    await expect(outcome).resolves.toBe('applied');
    expect(reads).toBe(3);
  });

  it('says unanswered when a speaker never acks within the limit', async () => {
    vi.useFakeTimers();
    const api = vi.fn(async () => ({ status: 'applied', ack_result: null })) as unknown as Api;
    const outcome = awaitSpeaker(api, 'ws', 'phone', 'cmd-2', { limitMs: 2000, everyMs: 500 });
    await vi.advanceTimersByTimeAsync(2600);
    await expect(outcome).resolves.toBe('unanswered');
  });

  it('stops waiting when a newer press takes over', async () => {
    vi.useFakeTimers();
    let wanted = true;
    const api = vi.fn(async () => ({ status: 'applied', ack_result: null })) as unknown as Api;
    const outcome = awaitSpeaker(api, 'ws', 'phone', 'cmd-3', { limitMs: 5000, everyMs: 500, stillWanted: () => wanted });
    await vi.advanceTimersByTimeAsync(600);
    wanted = false;
    await vi.advanceTimersByTimeAsync(600);
    await expect(outcome).resolves.toBe('unanswered');
    expect((api as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe('asConfirmed', () => {
  it('shows the state before an unconfirmed press until something newer happens', () => {
    const before = session({ state: 'playing', seq: 6 });
    const after = session({ state: 'paused', seq: 7 });
    const held = { command: 'pause', seq: 7, before, speakerName: 'Laptop' };
    expect(asConfirmed(after, held).state).toBe('playing');
    expect(asConfirmed(session({ state: 'paused', seq: 8 }), held).state).toBe('paused');
    expect(asConfirmed(after, null).state).toBe('paused');
    expect(unansweredWords('Laptop')).toBe("Laptop didn't answer. Nothing changed there.");
  });
});

describe('pressFailedWords', () => {
  it('says offline only when the network is gone, and couldn\'t reach for a server that did not answer', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    expect(pressFailedWords(new TypeError('Failed to fetch'))).toMatch(/You're offline/);
    online.mockReturnValue(true);
    expect(pressFailedWords(Object.assign(new Error('busy'), { status: 503 }))).toMatch(/Couldn't reach SelectaDJ/);
    expect(pressFailedWords(Object.assign(new Error('This device was signed out.'), { status: 403 }))).toBe('This device was signed out.');
    online.mockRestore();
  });
});

describe('changeWords (G70)', () => {
  it('says what a remote changed, and nothing for a seek within the song', () => {
    expect(changeWords('set_volume', { volume: 0 }, 1)).toBe('Muted');
    expect(changeWords('set_volume', { volume: 40 }, 1)).toBe('Volume changed');
    expect(changeWords('skip', undefined, 1)).toBe('Skipped');
    expect(changeWords('skip', { song_index: 0 }, 3)).toBe('Went back');
    expect(changeWords('seek', { song_index: 1, offset_ms: 5000 }, 1)).toBeNull();
    expect(changeWords('seek', { song_index: 0, offset_ms: 0 }, 1)).toBe('Went back');
    expect(changeWords('set_programme', { songs: [1, 2] }, 0)).toBe('Up next changed');
    expect(changeWords('stop', undefined, 0)).toBe('Stopped');
  });
});
