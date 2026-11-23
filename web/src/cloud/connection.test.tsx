import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import {
  configureConnection, getConnection, isOnline, needsConnectionReason, onReconnect, probeNow,
  reportOffline, reportOk, reportSignedOut, reportUnreachable, useNeedsConnection, waitForOnline,
} from './connection';
import { ConnectionBanner } from './ConnectionBanner';
import { checkedAt } from './offlineCache';

// One connection store for the Cloud tab, and the one quiet banner that reads it (plan "Nothing
// is lost", section 1). No raw errors, one next step, nothing shown while all is well.

let answers: boolean[] = [];
const probe = vi.fn(async () => answers.shift() ?? false);

beforeEach(() => {
  answers = [];
  probe.mockClear();
  configureConnection({ reset: true, probe });
});

afterEach(() => {
  vi.useRealTimers();
  configureConnection({ reset: true, probe: async () => false });
});

describe('connection store', () => {
  it('starts online and notes when the connection was lost', () => {
    expect(getConnection()).toMatchObject({ status: 'online', since: null, signedOut: false });
    reportUnreachable();
    expect(getConnection().status).toBe('unreachable');
    expect(getConnection().since).toEqual(expect.any(Number));
    expect(isOnline()).toBe(false);
  });

  it('the browser going offline says offline, and coming back probes the service', async () => {
    answers = [true];
    window.dispatchEvent(new Event('offline'));
    reportOffline();
    expect(getConnection().status).toBe('offline');
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(getConnection().status).toBe('online'));
    expect(probe).toHaveBeenCalled();
    expect(getConnection().backAt).toEqual(expect.any(Number));
  });

  it('a probe that fails schedules the next try with a growing wait', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    reportUnreachable();
    const first = getConnection().nextTryAt;
    expect(first).toBe(1_002_000);
    await act(async () => { await probeNow(); });
    expect(getConnection().status).toBe('unreachable');
    expect(getConnection().nextTryAt).toBe(1_004_000);
  });

  it('signed out is said apart from the connection, and cleared by the next answer', () => {
    reportSignedOut();
    expect(getConnection()).toMatchObject({ status: 'online', signedOut: true });
    reportOk();
    expect(getConnection().signedOut).toBe(false);
  });

  it('waitForOnline resolves on reconnect and rejects when stopped', async () => {
    reportOffline();
    const waiting = waitForOnline();
    const controller = new AbortController();
    const stopped = waitForOnline(controller.signal);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    reportOk();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('onReconnect runs work each time the connection comes back, not while it stays up', () => {
    const work = vi.fn();
    const stop = onReconnect(work);
    reportOk();
    expect(work).not.toHaveBeenCalled();
    reportUnreachable();
    reportOk();
    reportOffline();
    reportOk();
    expect(work).toHaveBeenCalledTimes(2);
    stop();
  });

  it('needsConnectionReason says why a server-only button waits', () => {
    expect(needsConnectionReason({ ...getConnection(), status: 'online' })).toBeNull();
    expect(needsConnectionReason({ ...getConnection(), status: 'offline' })).toMatch(/needs the internet/);
    expect(needsConnectionReason({ ...getConnection(), status: 'unreachable' })).toMatch(/isn’t answering/);
  });
});

describe('useNeedsConnection', () => {
  it('gives the reason while cloud.offline_shell is on, and nothing when it is off', () => {
    const { result, rerender } = renderHook(() => useNeedsConnection());
    expect(result.current).toBeNull();
    act(() => reportOffline());
    expect(result.current).toMatch(/needs the internet/);
    act(() => reportUnreachable());
    act(() => setFlags({ 'cloud.offline_shell': false }));
    rerender();
    expect(result.current).toBeNull();
  });
});

describe('ConnectionBanner', () => {
  it('shows nothing while everything is fine', () => {
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status', { hidden: true });
    expect(banner).not.toBeVisible();
  });

  it('offline: says SelectaDJ carries on, and keeps playing where the music is on this device', () => {
    const { rerender } = render(<ConnectionBanner />);
    act(() => reportOffline());
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline. SelectaDJ will carry on when the connection is back.');
    rerender(<ConnectionBanner plays />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline. SelectaDJ keeps playing and will carry on when the connection is back.');
    expect(screen.queryByRole('button', { name: 'Try now' })).toBeNull();
  });

  it('the service not answering: counts down to the next try and offers Try now', async () => {
    vi.useFakeTimers({ now: 5_000_000 });
    render(<ConnectionBanner />);
    act(() => reportUnreachable());
    expect(screen.getByRole('status')).toHaveTextContent('SelectaDJ’s service isn’t answering. Trying again in 2 s.');
    answers = [true];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try now' })); });
    expect(probe).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Back online. Catching up...');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByRole('status', { hidden: true })).not.toBeVisible();
  });

  it('says the library is what this device knows, with when it was last checked', () => {
    const at = new Date(2026, 10, 22, 14, 5).getTime();
    vi.useFakeTimers({ now: at + 60_000 });
    render(<ConnectionBanner cachedAt={at} />);
    act(() => reportOffline());
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('Showing what this device knows. Last checked');
    expect(text).toContain(`Last checked ${checkedAt(at, at + 60_000)}.`);
  });

  it('a page opened offline before the sign-in could be renewed says it signs in again later', () => {
    render(<ConnectionBanner signedOutOffline cachedAt={null} />);
    act(() => reportOffline());
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline. Showing what this device knows; you’ll be signed in again when the connection is back.');
  });

  it('never writes a raw browser error or an em dash', () => {
    render(<ConnectionBanner plays cachedAt={null} />);
    for (const step of [reportOffline, reportUnreachable]) {
      act(() => step());
      const text = screen.getByRole('status').textContent ?? '';
      expect(text).not.toMatch(/failed to fetch|networkerror/i);
      expect(text.includes(String.fromCharCode(8212))).toBe(false);
    }
  });
});
