import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioOwner, connectMainPlayer } from '../audio/focus';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { SHORTCUTS } from '../state/shortcuts';
import { fakeBackend, Reply, status } from '../test/backend';
import { HarmonicDiscoveries } from './Links';
import { Now } from './Now';

/** Polish ADR-0039 P0063/P0064 and ADR-0042 P0095/P0099, the parts no earlier test pinned down. */

const item = (id: number): MixItem => ({ position: id - 1, song_id: id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 20, bpm: 120, key: '8A', locked: false, seam: null });
const detail: SongDetail = { id: 1, artist: 'Artist 1', title: 'Song 1', duration: 20, bpm: 120, key: '8A', peaks: [], bar_times: [0, 8, 16], beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], beats_per_bar: 4, sections: [], lines: [] };

function listen(mix: MixItem[], position = 0) {
  const player = new SetPlayer(() => mix, () => {});
  return render(
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position, songTime: 2, duration: 20 }} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />,
  );
}

afterEach(cleanup);

describe('P0063 Next song and Jump to the transition are told apart', () => {
  it('in labels, icon, tooltip and shortcut help', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    listen([item(1), item(2)]);
    const next = screen.getByRole('button', { name: 'Next song' });
    const jump = screen.getByRole('button', { name: 'Jump to the transition' });
    expect(next.querySelector('svg')).not.toBeNull();
    expect(jump.querySelector('svg')).toBeNull();
    expect(next.textContent).not.toBe(jump.textContent);
    const help = Object.fromEntries(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));
    expect([help.next.label, help.next.keys]).toEqual(['Next song', 'Shift N']);
    expect([help.jump.label, help.jump.keys]).toEqual(['Jump to the transition', 'N']);
  });
});

describe('P0064 deliberate layouts for missing information', () => {
  it('a song whose details fail keeps the transport and offers a retry', async () => {
    fakeBackend({ 'GET /songs/1': new Reply(500, { detail: 'boom' }) });
    listen([item(1), item(2)]);
    expect(await screen.findByText(/Couldn’t load .*details\. Playback controls are still available\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('the last song says so and nothing offers a next song', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    listen([item(1)]);
    expect(await screen.findByText('This is the last song in the mix.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next song' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Jump to the transition' })).toBeDisabled();
  });
});

const discovery = (id: number, a: string, b: string) => ({ id, song_a: id * 10 + 1, song_b: id * 10 + 2, title_a: a, title_b: b, artist_a: 'A', artist_b: 'B', status: 'new', payload: { a_at: 12, b_at: 30, a_end: 28, b_end: 46, bars: 8, transpose: 2 } });
const audition = { chords: ['C', 'F', 'G', 'Am'], bar_starts: [0, 2, 4, 6], seconds: 8, semitones: 2 };

describe('ADR-0042 discovery auditions', () => {
  beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });

  it('P0095 a refused play is said, gives the sound back, and the stage can be tried again', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')], 'POST /discoveries/7/hear': audition });
    const resume = vi.fn();
    connectMainPlayer({ isPlaying: () => true, pause: vi.fn(), resume });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await screen.findByRole('button', { name: /Hear what Selecta heard/ }));
    expect(await screen.findByText('Couldn’t play this audition. Try the stage again.')).toBeInTheDocument();
    expect(screen.queryByText(/Now playing:/)).toBeNull();
    expect(audioOwner()?.id ?? null).not.toBe('harmonic-discoveries');
    play.mockImplementation(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /The chords Selecta heard/ }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    connectMainPlayer(null);
  });

  it('P0099 a background refresh with a new pair ahead keeps the pair being heard', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
    let rows = [discovery(7, 'First', 'Second'), discovery(8, 'Third', 'Fourth')];
    fakeBackend({ 'GET /discoveries': () => rows, 'POST /discoveries/7/hear': audition, 'POST /discoveries/8/hear': audition, 'POST /discoveries/9/hear': audition });
    render(<HarmonicDiscoveries />);
    expect(await screen.findByRole('heading', { name: /First/ })).toBeInTheDocument();
    rows = [discovery(9, 'Newer', 'Pair'), ...rows];
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.getByText('3 to hear')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /First/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: /Newer/ })).toBeInTheDocument();
  });
});

describe('P0089 one request vocabulary', () => {
  it('each stage has its own label from one shared source, and Listen and Edit share one tag', async () => {
    const { requestWords, RequestTag } = await import('./Requests');
    const row = { id: 1, song_id: 5, title: 'Wanted', artist: 'X', status: 'waiting', available: 1, route: [{ id: 4, title: 'Bridge' }, { id: 5, title: 'Wanted' }], after: 'Song 1' };
    const labels = (['waiting', 'searching', 'approve', 'preparing', 'ready'] as const).map((stage) => requestWords(row, stage).label);
    expect(labels).toEqual(['Requested · waiting', 'Finding a place', 'Needs your choice', 'Getting ready', 'Ready for an opening']);
    expect(new Set(labels).size).toBe(labels.length);
    render(<RequestTag item={{ from_request: { kind: 'requested' } } as never} />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });
});
