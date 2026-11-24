import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemoteListen, type PlayWays } from './RemoteListen';
import { useRemote } from './useRemote';
import { NO_SPEAKER_WORDS, type SessionView } from './usePlaybackDevice';
import type { DeviceHolding } from './controller';

// ADR-0475 R1 on a remote: when the speaker is away, or a press found nobody playing, the device
// in hand offers every way on from there, never only a sentence.

const SONGS = [11, 12, 13].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration_s: 200 }));
const seen = (speaker: SessionView['speaker']): SessionView => ({
  session: { mix_revision_id: null, song_index: 0, offset_ms: 0, anchor_at: null, state: 'paused', active_device_id: 'laptop', lease_expires_at: null, seq: 3, programme: SONGS.map((song) => ({ song_id: song.id, sha256: 'a' })) },
  speaker, speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: false, server_time: 1000,
});
const device = (over: Partial<DeviceHolding>): DeviceHolding => ({ device_id: 'tablet', name: 'Tablet', last_seen_at: 990, online: true, songs: 40, reported_at: 900, ...over });

function Harness({ view, ways, refusal }: { view: SessionView; ways: PlayWays; refusal?: string }) {
  const remote = useRemote({ remoteControl: true, device: { view, send: async () => true, serverNow: () => 1000 }, mixSongIds: [], loadSongs: async () => SONGS });
  return remote ? <RemoteListen remote={remote} playableHere={0} ways={ways} refusal={refusal} /> : null;
}
const ways = (over: Partial<PlayWays> = {}): PlayWays => ({ devices: [], asking: null, onPlayOn: vi.fn(), hereSongs: 0, onPlayHere: vi.fn(), now: 1000, ...over });

describe('every way on from a remote', () => {
  it('with the speaker away: Play on each open device with music, the one with most first, and Play here', async () => {
    const offered = ways({ devices: [device({ device_id: 'kitchen', name: 'Kitchen', songs: 5 }), device({}), device({ device_id: 'old', name: 'Old phone', online: false })], hereSongs: 2 });
    render(<Harness view={seen('offline')} ways={offered} />);
    const buttons = await screen.findAllByTestId('play-on');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Play on Tablet', 'Play on Kitchen']);
    expect(screen.getByTestId('play-here')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 songs')).toBeInTheDocument();
    await userEvent.click(buttons[0]);
    expect(offered.onPlayOn).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'tablet' }));
    await userEvent.click(screen.getByTestId('play-here'));
    expect(offered.onPlayHere).toHaveBeenCalled();
  });

  it('a Play that found nobody playing says so, with the ways on right there', async () => {
    render(<Harness view={seen('elsewhere')} ways={ways({ devices: [device({})] })} refusal={NO_SPEAKER_WORDS} />);
    expect(await screen.findByTestId('remote-refusal')).toHaveTextContent(NO_SPEAKER_WORDS);
    expect(screen.getByTestId('play-on')).toHaveTextContent('Play on Tablet');
  });

  it('with nowhere to play: says which step is missing instead of an empty list', async () => {
    render(<Harness view={seen('offline')} ways={ways({ devices: [device({ online: false })] })} />);
    expect(await screen.findByTestId('play-ways-none')).toHaveTextContent('Open SelectaDJ on one of them');
    expect(screen.queryByTestId('play-here')).toBeNull();
  });

  it('while the speaker plays, no ways are offered', async () => {
    render(<Harness view={seen('elsewhere')} ways={ways({ devices: [device({})] })} />);
    await screen.findByTestId('remote-title');
    expect(screen.queryByTestId('play-ways')).toBeNull();
  });
});
