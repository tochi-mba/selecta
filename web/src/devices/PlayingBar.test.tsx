import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IOS_WARNING } from './deviceInfo';
import { PlayingBar } from './PlayingBar';
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
  return (async (path: string) => {
    if (path === '/devices') return { device: { id: 'phone', name: 'Safari on iPhone', kind: 'phone', signed_in: true, this_device: true, poor_speaker: warnings.length > 0, last_seen_at: 0, warnings }, notice: null };
    if (path.startsWith('/playback/session')) return elsewhere;
    if (path === '/playback/reconnect') return { action: 'stop_moved', session, message: null };
    if (path === '/playback/take-over') return { session: { ...session, active_device_id: 'phone', seq: 4 }, previous_device: null, server_time: 100 };
    throw new Error(`unexpected ${path}`);
  }) as Api;
}

const source = async () => null;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the playing bar on a phone (SC-0415-05)', () => {
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
      delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
    }
  });
});
