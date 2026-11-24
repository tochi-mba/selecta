import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IOS_WARNING } from './deviceInfo';
import { OPTIMISTIC_MS, PlayingBar } from './PlayingBar';
import type { Api, SessionState, SessionView } from './usePlaybackDevice';

// SC-0415-05: the iOS speaker warning and the screen wake lock, where they apply. The warning is
// shown on an iPhone when it is about to become, or is, the speaker; never on a laptop; and Play
// here asks the browser to keep the screen awake.

const session: SessionState = {
  mix_revision_id: null, song_index: 0, offset_ms: 0, anchor_at: 100, state: 'playing',
  active_device_id: 'laptop', lease_expires_at: 120, seq: 3,
};
const elsewhere: SessionView = {
  session, speaker: 'elsewhere', speaker_device_id: 'laptop', speaker_name: 'Living-room laptop',
  ask_before_playing_here: true, server_time: 100,
};

function fakeApi(warnings: { code: string; text: string }[]): Api {
  let onPhone = false;
  return (async (path: string) => {
    if (path === '/devices') return { device: { id: 'phone', name: 'Safari on iPhone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: warnings.length > 0, last_seen_at: 0, warnings }, notice: null };
    if (path.startsWith('/playback/session')) return onPhone ? {
      ...elsewhere, session: { ...session, active_device_id: 'phone', seq: 4 },
      speaker: 'here', speaker_device_id: 'phone', ask_before_playing_here: false,
    } : elsewhere;
    if (path === '/playback/reconnect') return { action: 'stop_moved', session, message: null };
    if (path === '/playback/take-over') {
      onPhone = true;
      return { session: { ...session, active_device_id: 'phone', seq: 4 }, previous_device: null, server_time: 100 };
    }
    throw new Error(`unexpected ${path}`);
  }) as Api;
}

const source = async () => null;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('live transfer confirmation (AV-0419-05)', () => {
  it('checks the current lease before starting, even if the last poll said nobody was playing', async () => {
    let remotelyOwned = false;
    let sessionReads = 0;
    const takeOver = vi.fn(async () => ({
      session: { ...session, active_device_id: 'phone', seq: 4 },
      previous_device: null, server_time: 100,
    }));
    const api = (async (path: string) => {
      if (path === '/devices') return { device: {
        id: 'phone', name: 'Safari on iPhone', kind: 'phone', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path.startsWith('/playback/session')) {
        sessionReads++;
        return remotelyOwned ? elsewhere : {
          session: null, speaker: 'none', speaker_device_id: null, speaker_name: null,
          ask_before_playing_here: false, server_time: 100,
        };
      }
      if (path === '/playback/reconnect') return { action: 'stop_moved', session: null, message: null };
      if (path === '/playback/take-over') return takeOver();
      throw new Error(`unexpected ${path}`);
    }) as Api;
    render(<PlayingBar api={api} workspaceId="ws-live" source={source} />);
    await screen.findByText('Nothing is playing');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play here' })).toBeEnabled());
    remotelyOwned = true; // Device 1 acquires the lease between Device 2's polls.
    const beforeClick = sessionReads;
    await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
    expect(sessionReads).toBeGreaterThan(beforeClick);
    expect(await screen.findByRole('alertdialog', { name: 'Move playback here?' })).toHaveTextContent('Play here instead');
    expect(takeOver).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Play here instead' }));
    await waitFor(() => expect(takeOver).toHaveBeenCalledTimes(1));
  });
});

describe('overlapping device polls (AV-0419-05)', () => {
  it('keeps the button confirmation when a reconnect poll overtakes its server response', async () => {
    let finishReconnect!: (value: unknown) => void;
    let finishClickRead!: (value: SessionView) => void;
    let reads = 0;
    const takeover = vi.fn();
    const api = (async (path: string) => {
      if (path === '/devices') return { device: {
        id: 'phone', name: 'Second device', kind: 'laptop', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') return new Promise<unknown>((resolve) => { finishReconnect = resolve; });
      if (path.startsWith('/playback/session')) {
        reads += 1;
        if (reads === 1) return new Promise<SessionView>((resolve) => { finishClickRead = resolve; });
        return elsewhere;
      }
      if (path === '/playback/take-over') return takeover();
      throw new Error(`unexpected ${path}`);
    }) as Api;
    render(<PlayingBar api={api} workspaceId="ws-overlap" source={source} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play here' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
    await waitFor(() => expect(reads).toBe(1));
    // Device registration's reconnect finishes after the click. Its own look now waits for the
    // click's look instead of starting on top of it, so the button's answer cannot be overtaken.
    finishReconnect({ action: 'stop_moved', session, message: null });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reads).toBe(1);
    finishClickRead(elsewhere);
    expect(await screen.findByRole('alertdialog', { name: 'Move playback here?' })).toBeVisible();
    expect(takeover).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(takeover).not.toHaveBeenCalled();
  });
});

describe('the playing bar on a phone (SC-0415-05)', () => {
  it('calls a lapsed remote speaker uncertain instead of claiming it is playing (ADR-0461)', async () => {
    const api = (async (path: string) => {
      if (path === '/devices') return { device: {
        id: 'phone', name: 'Phone', kind: 'phone', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') return {
        action: 'stop_moved', session: { ...session, state_confidence: 'uncertain' }, message: null,
      };
      if (path.startsWith('/playback/session')) return {
        ...elsewhere, session: { ...session, state_confidence: 'uncertain' },
      };
      throw new Error(`unexpected ${path}`);
    }) as Api;
    render(<PlayingBar api={api} workspaceId="ws-uncertain" source={source} />);
    expect(await screen.findByText(/has not checked in recently and may still be playing/)).toBeVisible();
    expect(screen.queryByText(/^Playing on /)).toBeNull();
  });

  it('warns an iPhone to keep the screen on when it is asked to play here', async () => {
    render(<PlayingBar api={fakeApi([{ code: 'ios_keep_screen_on', text: IOS_WARNING }])} workspaceId="ws" source={source} />);
    expect(await screen.findByText('Playing on Living-room laptop', {}, { timeout: 8000 })).toBeTruthy();
    // Only a remote so far: no warning yet.
    expect(screen.queryByRole('note')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Playing on Living-room laptop. Play here instead?');
    expect(screen.getByRole('note').textContent).toBe(IOS_WARNING);
  });

  it('never warns a laptop', async () => {
    render(<PlayingBar api={fakeApi([])} workspaceId="ws" source={source} />);
    expect(await screen.findByText('Playing on Living-room laptop', {}, { timeout: 8000 })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('asks for a screen wake lock when this device becomes the speaker', async () => {
    const request = vi.fn(async () => ({ release: async () => undefined, released: false }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    try {
      render(<PlayingBar api={fakeApi([{ code: 'ios_keep_screen_on', text: IOS_WARNING }])} workspaceId="ws" source={source} />);
      expect(await screen.findByText('Playing on Living-room laptop', {}, { timeout: 8000 })).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
      await userEvent.click(screen.getByRole('button', { name: 'Play here instead' }));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      expect(request).toHaveBeenCalledWith('screen');
    } finally {
      Reflect.deleteProperty(navigator, 'wakeLock');
    }
  });
});

// W3: a remote's Pause shows at once, busy until the server answers, and a refusal puts it back.
describe('optimistic play and pause', () => {
  it('shows the press straight away and rolls it back when the server refuses', async () => {
    let refuse!: (error: Error) => void;
    const api = (async (path: string) => {
      if (path === '/devices') return { device: { id: 'phone', name: 'Phone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
      if (path === '/playback/reconnect') return { action: 'stop_moved', session, message: null };
      if (path.startsWith('/playback/session')) return elsewhere;
      if (path === '/playback/commands') return new Promise((_, reject) => { refuse = reject; });
      throw new Error(`unexpected ${path}`);
    }) as Api;
    render(<PlayingBar api={api} workspaceId="ws-optimistic" source={source} />);
    const pause = await screen.findByRole('button', { name: 'Pause' }, { timeout: 8000 });
    await userEvent.click(pause);
    const shown = await screen.findByRole('button', { name: 'Play' });
    expect(shown).toHaveAttribute('aria-busy', 'true');
    await act(async () => { refuse(new Error('The speaker said no.')); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('The speaker said no.');
  });

  it('lets an accepted press the speaker never applies lapse back to the reported state (M9)', async () => {
    // the server takes the command, but the (offline) speaker never moves the session on
    const api = (async (path: string) => {
      if (path === '/devices') return { device: { id: 'phone', name: 'Phone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
      if (path === '/playback/reconnect') return { action: 'stop_moved', session, message: null };
      if (path.startsWith('/playback/session')) return elsewhere;
      if (path === '/playback/commands') return { command_id: 'c1' };
      throw new Error(`unexpected ${path}`);
    }) as Api;
    render(<PlayingBar api={api} workspaceId="ws-lapse" source={source} />);
    const pause = await screen.findByRole('button', { name: 'Pause' }, { timeout: 8000 });
    const pressed = Date.now();
    await userEvent.click(pause);
    expect(await screen.findByRole('button', { name: 'Play' })).toBeVisible();
    // the session still says playing at seq 3, so once the ack window passes the bar says so
    expect(await screen.findByRole('button', { name: 'Pause' }, { timeout: OPTIMISTIC_MS + 3000 })).toBeVisible();
    expect(Date.now() - pressed).toBeGreaterThanOrEqual(OPTIMISTIC_MS - 50);
  }, OPTIMISTIC_MS + 15_000);
});
