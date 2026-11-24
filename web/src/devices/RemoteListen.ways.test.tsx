import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemoteListen, type PlayWays } from './RemoteListen';
import { useRemote } from './useRemote';
import { NO_SPEAKER_WORDS, type SessionView } from './usePlaybackDevice';
import type { DeviceHolding } from './controller';
import { ControllerListen, holdingWords } from './ControllerListen';

// ADR-0475 R1 on a remote: when the speaker is away, or a press found nobody playing, the device
// in hand offers every way on from there, never only a sentence.

const SONGS = [11, 12, 13].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration_s: 200 }));
const seen = (speaker: SessionView['speaker']): SessionView => ({
  session: { mix_revision_id: null, song_index: 0, offset_ms: 0, anchor_at: null, state: 'paused', active_device_id: 'laptop', lease_expires_at: null, seq: 3, programme: SONGS.map((song) => ({ song_id: song.id, sha256: 'a' })) },
  speaker, speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: false, server_time: 1000,
});
const device = (over: Partial<DeviceHolding>): DeviceHolding => ({ device_id: 'tablet', name: 'Tablet', last_seen_at: 990, online: true, songs: 40, reported_at: 900, ...over });

function Harness({ view, ways, refusal, held }: { view: SessionView; ways: PlayWays; refusal?: string; held?: ReadonlySet<number> }) {
  const remote = useRemote({ remoteControl: true, device: { view, send: async () => true, serverNow: () => 1000 }, mixSongIds: [], loadSongs: async () => SONGS });
  return remote ? <RemoteListen remote={remote} playableHere={0} ways={ways} refusal={refusal} speakerSongs={held} /> : null;
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

describe('R3: songs the speaker does not hold', () => {
  it('are marked "Not on {speaker}" in Up next', async () => {
    render(<Harness view={seen('elsewhere')} ways={ways()} held={new Set([11, 12])} />);
    const marks = await screen.findAllByTestId('not-on-speaker');
    expect(marks.map((mark) => mark.textContent)).toEqual(['Not on Laptop']);
  });
});

describe('R1 picker and R3 pre-flight with the mix known', () => {
  const ids = new Map<string, ReadonlySet<number>>([['tablet', new Set([1, 2])], ['laptop', new Set([1, 2, 3, 4])]]);
  it('suggests the device with most of the mix, and says how many of it each holds', () => {
    render(<ControllerListen mixName="Friday" mixSongs={4} mixIds={[1, 2, 3, 4]} ids={ids} devices={[device({ songs: 900 }), device({ device_id: 'laptop', name: 'Laptop', songs: 40 })]} thisDeviceId="phone" now={1000} asking={null} onPlayOn={vi.fn()} />);
    expect(screen.getByTestId('play-on')).toHaveTextContent('Play on Laptop');
    expect(screen.queryByTestId('preflight')).toBeNull();
    expect(screen.getByText('All 4 songs')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 songs')).toBeInTheDocument();
  });
  it('says what the suggested device will skip, and offers one that has them all', () => {
    const onPlayOn = vi.fn();
    const partial = new Map<string, ReadonlySet<number>>([['tablet', new Set([1, 2, 3])], ['laptop', new Set([1, 2, 3, 4])]]);
    // the laptop is not open, so the tablet is suggested
    render(<ControllerListen mixName="Friday" mixSongs={4} mixIds={[1, 2, 3, 4]} ids={partial} devices={[device({}), device({ device_id: 'laptop', name: 'Laptop', online: false })]} thisDeviceId="phone" now={1000} asking={null} onPlayOn={onPlayOn} />);
    expect(screen.getByTestId('preflight')).toHaveTextContent('Tablet has 3 of these 4 songs. The other one will be skipped.');
    expect(screen.queryByTestId('play-on-whole')).toBeNull();
    expect(holdingWords(device({}), 1000, { held: 0, total: 4 })).toBe('None of these songs');
  });
});
