import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LUCY_WINDOWS } from '../test/cloudAccount';
import {
  backWords, confirmExtraUsage, expiresSoon, expiryWords, extraWords, leftWords, lineWords, LUCY_USAGE_EVENT, nearestReset, newsWords, stateWords, usageLines, useLucyUsage, whenWords, windowsOf,
  type LucyWindow, type LucyWindows,
} from './lucyUsage';

const share = (over: Partial<LucyWindow> = {}): LucyWindow => ({ left: 72, state: 'ok', resets_at: 1_800_000_000, back_words: '16:40', segments: 4, ...over });

afterEach(() => { vi.useRealTimers(); });

describe('Lucy usage in words (ADR-0484)', () => {
  it('says what is left, never what was used', () => {
    expect(leftWords(share())).toBe('72% left');
    expect(leftWords(share({ left: 0, state: 'spent' }))).toBe('0% left');
  });

  it('joins the server’s reset words on: "at" for a time today, the weekday as it is', () => {
    expect(backWords(share())).toBe('back at 16:40');
    expect(backWords(share({ back_words: 'Thursday 09:00' }), 'week')).toBe('back Thursday 09:00');
    expect(whenWords('9:05')).toBe('at 9:05');
    expect(whenWords(null)).toBe('');
    expect(backWords(share({ back_words: null }), 'week')).toBe('');
  });

  it('calls a session nobody has opened "not started", and a week never', () => {
    expect(backWords(share({ open: false }))).toBe('not started');
    expect(backWords(share({ resets_at: null, back_words: null }))).toBe('not started');
    expect(backWords(share({ resets_at: null, back_words: null }), 'week')).toBe('');
  });

  it('gives near and spent their own words, and none while there is plenty', () => {
    expect(stateWords('ok')).toBe('');
    expect(stateWords('near')).toBe('Nearly used up');
    expect(stateWords('spent')).toBe('Used up');
    expect(stateWords('near')).not.toBe(stateWords('spent'));
  });

  it('puts the figure and the reset in one line for a bar to say aloud', () => {
    expect(lineWords(share())).toBe('72% left, back at 16:40');
    expect(lineWords(share({ left: 100, open: false }))).toBe('100% left, not started');
  });
});

describe('reading the server’s figures', () => {
  it('is null when the key is absent, null or not a shape this build knows', () => {
    expect(windowsOf(undefined)).toBeNull();
    expect(windowsOf(null)).toBeNull();
    expect(windowsOf({ session: null })).toBeNull();
    expect(windowsOf({ week: { left: '90' } })).toBeNull();
  });

  it('keeps the week alone when the account has no session window', () => {
    const windows = windowsOf({ session: null, week: LUCY_WINDOWS.week })!;
    expect(usageLines(windows).map((line) => line.name)).toEqual(['This week']);
  });

  it('draws a session that has not started as full, and keeps figures inside their range', () => {
    const windows = windowsOf({ session: { left: 40, state: 'near', resets_at: null, back_words: null, segments: 2, open: false }, week: { left: 140, state: 'ok', resets_at: 5, back_words: 'Thursday 09:00', segments: 9 } })!;
    expect(windows.session).toMatchObject({ left: 100, state: 'ok', segments: 5 });
    expect(windows.week).toMatchObject({ left: 100, segments: 5 });
    expect(usageLines(windows).map((line) => line.name)).toEqual(['This session', 'This week']);
  });

  it('finds the nearest reset still to come', () => {
    const now = 1_000_000 * 1000;
    const windows: LucyWindows = { session: share({ resets_at: 1_000_600 }), week: share({ resets_at: 1_090_000 }) };
    expect(nearestReset(windows, now)).toBe(1_000_600);
    expect(nearestReset({ ...windows, session: share({ resets_at: 999_000 }) }, now)).toBe(1_090_000);
    expect(nearestReset({ session: null, week: share({ resets_at: 999_000 }) }, now)).toBeNull();
    expect(nearestReset(null, now)).toBeNull();
  });

  it('has news only when a state changes or a lighter Lucy starts or stops', () => {
    const before: LucyWindows = { session: share(), week: share({ back_words: 'Thursday 09:00' }) };
    expect(newsWords(before, { ...before, session: share({ left: 60 }) })).toEqual([]);
    expect(newsWords(before, { ...before, session: share({ left: 15, state: 'near' }) })).toEqual(['This session: nearly used up, 15% left, back at 16:40']);
    expect(newsWords(before, { ...before, lighter: true })).toEqual(['A lighter Lucy is answering until this session ends']);
    expect(newsWords({ ...before, lighter: true }, before)).toEqual(['Lucy is back to normal']);
  });
});

describe('useLucyUsage', () => {
  const answer = (usage_windows?: unknown) => ({ enabled: true, tier: 'Lucy Standard', usage: { used: 1, limit: 40 }, ...(usage_windows === undefined ? {} : { usage_windows }) });

  it('asks nothing and holds nothing without a request', () => {
    const { result } = renderHook(() => useLucyUsage(undefined));
    expect(result.current).toBeNull();
  });

  it('keeps only the usage figures, and stays null for a server that does not send them', async () => {
    const request = vi.fn(async () => answer(LUCY_WINDOWS));
    const { result } = renderHook(() => useLucyUsage(request as never));
    await waitFor(() => expect(result.current?.week.left).toBe(90));
    expect(request).toHaveBeenCalledWith('/account/lucy');
    expect(Object.keys(result.current!).sort()).toEqual(['extra', 'lighter', 'session', 'week']);

    const old = vi.fn(async () => answer());
    const older = renderHook(() => useLucyUsage(old as never));
    await waitFor(() => expect(old).toHaveBeenCalledTimes(1));
    expect(older.result.current).toBeNull();
  });

  it('reads again when the server says the usage moved, and keeps what it had when a read fails', async () => {
    let left = 72;
    let fail = false;
    const request = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return answer({ ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left } });
    });
    const { result } = renderHook(() => useLucyUsage(request as never));
    await waitFor(() => expect(result.current?.session?.left).toBe(72));
    left = 55;
    act(() => { window.dispatchEvent(new Event(LUCY_USAGE_EVENT)); });
    await waitFor(() => expect(result.current?.session?.left).toBe(55));
    fail = true;
    act(() => { window.dispatchEvent(new Event(LUCY_USAGE_EVENT)); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(result.current?.session?.left).toBe(55);
  });

  it('reads once more when the nearest reset passes, on one timer, and not again for a reset already past', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T16:30:00Z'));
    const soon = Date.UTC(2026, 10, 25, 16, 40) / 1000;
    const request = vi.fn(async () => answer({ ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, resets_at: soon }, week: { ...LUCY_WINDOWS.week, resets_at: soon + 86_400 * 9 } }));
    renderHook(() => useLucyUsage(request as never));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
    expect(request).toHaveBeenCalledTimes(1);
    // the reset passes: one more read; the server still names the old session reset, which is
    // now behind us, so the only timer left is the week's
    await act(async () => { await vi.advanceTimersByTimeAsync(62_000); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('extra usage (ADR-0486)', () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const at = (days: number) => now / 1000 + days * 86_400;
  const zone = { locale: 'en-GB', timeZone: 'UTC' };

  it('is kept only while the server sends a balance, with its expiry when one is given', () => {
    expect(windowsOf({ week: LUCY_WINDOWS.week })!.extra).toBeNull();
    expect(windowsOf({ week: LUCY_WINDOWS.week, extra: null })!.extra).toBeNull();
    expect(windowsOf({ week: LUCY_WINDOWS.week, extra: { left: '40' } })!.extra).toBeNull();
    expect(windowsOf({ week: LUCY_WINDOWS.week, extra: { left: 40 } })!.extra).toEqual({ left: 40 });
    expect(windowsOf({ week: LUCY_WINDOWS.week, extra: { left: 140, expires_at: 1_900_000_000, units: 9 } })!.extra).toEqual({ left: 100, expires_at: 1_900_000_000 });
    expect(windowsOf({ week: LUCY_WINDOWS.week, extra: { left: 40, expires_at: 'soon' } })!.extra).toEqual({ left: 40 });
  });

  it('gives the date it runs out, and counts the days when that is soon', () => {
    expect(expiryWords({ left: 40 }, now, zone)).toBe('');
    expect(expiresSoon({ left: 40 }, now)).toBe(false);
    expect(expiryWords({ left: 40, expires_at: at(100) }, now, zone)).toBe('expires 5 March 2027');
    expect(expiresSoon({ left: 40, expires_at: at(100) }, now)).toBe(false);
    expect(expiresSoon({ left: 40, expires_at: at(14) }, now)).toBe(true);
    expect(expiryWords({ left: 40, expires_at: at(14) }, now, zone)).toBe('expires in 14 days');
    expect(expiryWords({ left: 40, expires_at: at(1.5) }, now, zone)).toBe('expires tomorrow');
    expect(expiryWords({ left: 40, expires_at: at(0.2) }, now, zone)).toBe('expires today');
    expect(extraWords({ left: 40, expires_at: at(100) }, now, zone)).toBe('40% left, expires 5 March 2027');
    expect(extraWords({ left: 40 }, now, zone)).toBe('40% left');
  });

  it('says yes, reads the meter again and tells every meter on the page to', async () => {
    const heard = vi.fn();
    window.addEventListener(LUCY_USAGE_EVENT, heard);
    const request = vi.fn(async (path: string) => (path === '/account/lucy' ? { usage_windows: { ...LUCY_WINDOWS, extra: { left: 80 } } } : { confirmed: true }));
    await expect(confirmExtraUsage(request as never)).resolves.toBe('on');
    expect(request.mock.calls).toEqual([['/billing/lucy-packs/confirm', { method: 'POST' }], ['/account/lucy']]);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(LUCY_USAGE_EVENT, heard);
  });

  it('answers "none" when the balance had gone, and keeps the yes when only the read fails', async () => {
    const gone = vi.fn(async (path: string) => (path === '/account/lucy' ? { usage_windows: LUCY_WINDOWS } : { confirmed: true }));
    await expect(confirmExtraUsage(gone as never)).resolves.toBe('none');
    const unread = vi.fn(async (path: string) => {
      if (path === '/account/lucy') throw new Error('offline');
      return { confirmed: true };
    });
    await expect(confirmExtraUsage(unread as never)).resolves.toBe('on');
  });

  it('throws when the yes did not land, and reads nothing', async () => {
    const heard = vi.fn();
    window.addEventListener(LUCY_USAGE_EVENT, heard);
    const request = vi.fn(async () => { throw new Error('The week changed. Try again.'); });
    await expect(confirmExtraUsage(request as never)).rejects.toThrow('The week changed');
    expect(request).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(LUCY_USAGE_EVENT, heard);
  });
});
