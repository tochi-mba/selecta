import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemoteListen } from './RemoteListen';
import type { SongDetails } from './remoteNow';
import { useRemote } from './useRemote';
import type { SessionState, SessionView } from './usePlaybackDevice';

// Listen on a device that is not the speaker (flag devices.remote_control): what it shows in
// each state, and that every press is one command.

const SONGS: ({ id: number } & SongDetails)[] = [
  { id: 11, title: 'Alpha', artist: 'Rex', duration_s: 200 },
  { id: 12, title: 'Bravo', artist: 'Tochi', duration_s: 180 },
  { id: 13, title: 'Charlie', artist: 'Rex', duration_s: 240 },
];
const session = (changes: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: null, song_index: 1, offset_ms: 20_000, anchor_at: 1000, state: 'playing', active_device_id: 'laptop', lease_expires_at: null, seq: 7,
  state_confidence: 'fresh', volume: 60, programme: [{ song_id: 11, sha256: 'a' }, { song_id: 12, sha256: 'b' }, { song_id: 13, sha256: 'c' }], ...changes,
});
const view = (changes: Partial<SessionView> = {}, state: Partial<SessionState> = {}): SessionView => ({
  session: session(state), speaker: 'elsewhere', speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: true, server_time: 1010, ...changes,
});

function Harness({ seen, remoteControl = true, mix = [], send, songs = SONGS, playableHere = 0 }: {
  seen: SessionView | null; remoteControl?: boolean; mix?: number[]; send: (name: string, args?: Record<string, unknown>) => Promise<boolean>; songs?: typeof SONGS; playableHere?: number;
}) {
  // ten seconds after the session's anchor
  const remote = useRemote({ remoteControl, device: { view: seen, send, serverNow: () => 1010 }, mixSongIds: mix, loadSongs: async () => songs });
  return remote ? <RemoteListen remote={remote} playableHere={playableHere} /> : <p>Connect your music to start listening</p>;
}

function open(seen: SessionView | null, options: { remoteControl?: boolean; mix?: number[]; songs?: typeof SONGS; playableHere?: number; refuses?: boolean } = {}) {
  const send = vi.fn(async () => !options.refuses);
  render(<Harness seen={seen} send={send} remoteControl={options.remoteControl} mix={options.mix} songs={options.songs} playableHere={options.playableHere} />);
  return { send };
}

describe('the remote on Listen', () => {
  it('shows what is playing on the other device, where it has got to and what is next', async () => {
    open(view());
    expect(await screen.findByTestId('remote-title')).toHaveTextContent('Bravo');
    expect(screen.getByTestId('remote-where')).toHaveTextContent('Playing on Laptop');
    expect(screen.getByTestId('remote-artist')).toHaveTextContent('Tochi');
    expect(screen.getByText('Song 2 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('remote-elapsed')).toHaveTextContent('0:30');
    expect(screen.getByTestId('remote-total')).toHaveTextContent('3:00');
    expect(screen.getByRole('slider', { name: 'Position in the song' })).toHaveValue('30000');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Up next' })).getByText('Charlie')).toBeInTheDocument();
    expect(screen.queryByTestId('remote-state')).toBeNull();
    expect(screen.queryByText('Connect your music to start listening')).toBeNull();
  });

  it('says plainly that a device with no music works as a remote, with a way to connect some', async () => {
    open(view());
    expect(await screen.findByTestId('remote-device')).toHaveTextContent('This device has no music on it, so it works as a remote.');
    expect(within(screen.getByTestId('remote-device')).getByRole('link', { name: 'Connect music' })).toBeInTheDocument();
  });

  it('offers playing here only as making a mix here, when this device has songs', async () => {
    open(view(), { playableHere: 12 });
    expect(await screen.findByTestId('remote-device')).toHaveTextContent(/working as a remote/);
    expect(screen.queryByText(/no music on it/)).toBeNull();
  });

  it('paused: says so, holds the position, and the button plays', async () => {
    const { send } = open(view({}, { state: 'paused', anchor_at: null }));
    expect(await screen.findByTestId('remote-where')).toHaveTextContent('Paused on Laptop');
    expect(screen.getByTestId('remote-elapsed')).toHaveTextContent('0:20');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('play', undefined);
    // the press shows at once, until the speaker answers
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('takes a refused press back', async () => {
    open(view(), { refuses: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('speaker offline: never claims it is playing, and says presses wait', async () => {
    open(view({ speaker: 'offline' }));
    expect(await screen.findByTestId('remote-where')).toHaveTextContent('Laptop is offline');
    expect(screen.getByTestId('remote-state')).toHaveTextContent(/may still be playing.*waits for it to come back/);
    expect(screen.getByTestId('remote-elapsed')).toHaveTextContent('0:20');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('a speaker that has not checked in, or whose sound is interrupted, is said in a small status', async () => {
    open(view({}, { state_confidence: 'uncertain', output_status: 'interrupted' }));
    expect(await screen.findByTestId('remote-state')).toHaveTextContent(/has not checked in recently/);
  });

  it('stopped: says so and offers play', async () => {
    open(view({}, { state: 'stopped', anchor_at: null }));
    expect(await screen.findByTestId('remote-where')).toHaveTextContent('Stopped on Laptop');
    expect(screen.getByTestId('remote-state')).toHaveTextContent(/stopped/);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('unknown song details: the song by number, no seek bar, and the reason', async () => {
    open(view(), { songs: [] });
    expect(await screen.findByTestId('remote-title')).toHaveTextContent('Song 2 of 3');
    expect(screen.queryByTestId('remote-artist')).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Position in the song' })).toBeNull();
    expect(screen.getByText(/length isn’t known here/)).toBeInTheDocument();
    expect(screen.queryByTestId('remote-total')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Up next' })).getByText('Song 3 of 3')).toBeInTheDocument();
  });

  it('with devices.remote_control off, the page is the old empty state', () => {
    open(view(), { remoteControl: false });
    expect(screen.getByText('Connect your music to start listening')).toBeInTheDocument();
    expect(screen.queryByTestId('remote-where')).toBeNull();
  });

  it('is not shown on the speaker, with nothing playing, or when this device holds the same mix', () => {
    for (const seen of [view({ speaker: 'here' }), view({ speaker: 'none' }), view({ session: null }), null]) {
      const { send } = open(seen);
      expect(screen.queryByTestId('remote-where')).toBeNull();
      expect(send).not.toHaveBeenCalled();
    }
    open(view(), { mix: [11, 12, 13] });
    expect(screen.queryByTestId('remote-where')).toBeNull();
  });
});

describe('each press is one command', () => {
  it('next skips, and is off on the last song', async () => {
    const { send } = open(view());
    await userEvent.click(await screen.findByRole('button', { name: 'Next song' }));
    expect(send.mock.calls).toEqual([['skip', undefined]]);
  });

  it('next is disabled on the last song', async () => {
    open(view({}, { song_index: 2 }));
    expect(await screen.findByRole('button', { name: 'Next song' })).toBeDisabled();
  });

  it('previous restarts the song when more than three seconds in', async () => {
    const { send } = open(view());
    await userEvent.click(await screen.findByRole('button', { name: 'Previous' }));
    expect(send.mock.calls).toEqual([['seek', { song_index: 1, offset_ms: 0 }]]);
  });

  it('previous goes back one song within the first three seconds', async () => {
    const { send } = open(view({}, { offset_ms: 500, state: 'paused', anchor_at: null }));
    await userEvent.click(await screen.findByRole('button', { name: 'Previous' }));
    expect(send.mock.calls).toEqual([['seek', { song_index: 0, offset_ms: 0 }]]);
  });

  it('tapping a song in Up next skips to it', async () => {
    const { send } = open(view({}, { song_index: 0 }));
    await userEvent.click(await screen.findByRole('button', { name: /Charlie/ }));
    expect(send.mock.calls).toEqual([['skip', { song_index: 2 }]]);
  });

  it('dragging the seek bar sends one seek, on release', async () => {
    const { send } = open(view());
    const bar = await screen.findByRole('slider', { name: 'Position in the song' });
    fireEvent.change(bar, { target: { value: '40000' } });
    fireEvent.change(bar, { target: { value: '70000' } });
    fireEvent.change(bar, { target: { value: '95000' } });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByTestId('remote-elapsed')).toHaveTextContent('1:35');
    fireEvent.pointerUp(bar);
    fireEvent.blur(bar);
    expect(send.mock.calls).toEqual([['seek', { song_index: 1, offset_ms: 95_000 }]]);
    // where it was put stays shown until the speaker reports again
    expect(screen.getByTestId('remote-elapsed')).toHaveTextContent('1:35');
  });

  it('the seek bar works from the keyboard: one seek per key released', async () => {
    const { send } = open(view());
    const bar = await screen.findByRole('slider', { name: 'Position in the song' });
    fireEvent.change(bar, { target: { value: '31000' } });
    fireEvent.keyUp(bar, { key: 'ArrowRight' });
    expect(send.mock.calls).toEqual([['seek', { song_index: 1, offset_ms: 31_000 }]]);
  });

  it('the volume slider shows when the session carries a volume, and sends once on release', async () => {
    const { send } = open(view());
    const slider = await screen.findByRole('slider', { name: 'Volume' });
    expect(slider).toHaveValue('60');
    fireEvent.change(slider, { target: { value: '45' } });
    fireEvent.change(slider, { target: { value: '30' } });
    expect(send).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(send.mock.calls).toEqual([['set_volume', { volume: 30 }]]);
  });

  it('there is no volume slider when the session carries none', async () => {
    open(view({}, { volume: null }));
    await screen.findByTestId('remote-title');
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull();
  });
});

describe('the mini player contract', () => {
  function Mini({ seen, send }: { seen: SessionView; send: (name: string, args?: Record<string, unknown>) => Promise<boolean> }) {
    const remote = useRemote({ remoteControl: true, device: { view: seen, send, serverNow: () => 1010 }, mixSongIds: [], loadSongs: async () => SONGS });
    if (!remote) return null;
    return (
      <div>
        <p data-testid="mini-song">{remote.song.title} / {remote.song.artist} / {remote.now.phase} / {Math.round(remote.now.songTime)} of {remote.now.duration}</p>
        <button onClick={() => void remote.player.togglePause()}>toggle</button>
        <button onClick={() => void remote.player.next()}>next</button>
      </div>
    );
  }

  it('presents the remote session as a song and a now state, and routes presses to commands', async () => {
    const send = vi.fn(async () => true);
    render(<Mini seen={view()} send={send} />);
    await waitFor(() => expect(screen.getByTestId('mini-song')).toHaveTextContent('Bravo / Tochi · on Laptop / playing / 30 of 180'));
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(send.mock.calls).toEqual([['pause', undefined], ['skip', undefined]]);
  });

  it('a stopped session has no mini player (its phase is idle)', async () => {
    render(<Mini seen={view({}, { state: 'stopped', anchor_at: null })} send={vi.fn(async () => true)} />);
    await waitFor(() => expect(screen.getByTestId('mini-song')).toHaveTextContent(/idle/));
  });
});
