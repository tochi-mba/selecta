import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/** UF-0374-04: found by the owner-delegated audio-clock check (2026-11-12). After a transition's
 * switch point the song that is entering is already current, while the transition clip still plays.
 * The hand-off must keep naming that song, never the one after it, whose transition has not begun. */

const song = (id: number, seam: MixItem['seam'] = null): MixItem => ({
  position: id - 1, song_id: id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 20,
  bpm: 120, key: '8A', locked: false, seam,
});

const ready = (key: string) => ({ settings: { move: 'blend' }, state: { status: 'ready', key, style: 'blend', switch_at: 4 } }) as MixItem['seam'];

const detail = (id: number): SongDetail => ({
  id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 20, bpm: 120, key: '8A',
  peaks: [], bar_times: [0, 8, 16], beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], beats_per_bar: 4,
  sections: [], lines: [],
});

function show(now: Partial<SetPlayer['state']>) {
  const mix = [song(1), song(2, ready('a')), song(3, ready('b'))];
  const player = new SetPlayer(() => mix, () => {});
  render(
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', duration: 20, ...now }}
      setView={() => {}} notify={() => {}} stage toggleStage={() => {}} />,
  );
}

afterEach(() => {
  window.localStorage.clear();
  setPrefs({ motion: 'subtle' });
});

describe('UF-0374-04 the hand-off follows the transition actually playing', () => {
  it('in the tail of the transition into Song 2, it still names Song 2 entering from Song 1', async () => {
    setPrefs({ motion: 'still' });
    fakeBackend({ 'GET /songs/2': detail(2), 'GET /songs/1': detail(1), 'GET /songs/3': detail(3) });
    show({ position: 1, songTime: 1, seamAt: 10, inSeam: true, seamTail: true, nextReady: true });
    const region = await screen.findByRole('region', { name: 'Transition into Song 2 is playing' });
    expect(region.querySelector('.handoff-pair')).toHaveTextContent('From Song 1Into Song 2');
    expect(screen.queryByRole('region', { name: 'Transition into Song 3 is playing' })).toBeNull();
  });

  it('when the next transition itself starts, it names the song after', async () => {
    setPrefs({ motion: 'still' });
    fakeBackend({ 'GET /songs/2': detail(2), 'GET /songs/1': detail(1), 'GET /songs/3': detail(3) });
    show({ position: 1, songTime: 12, seamAt: 10, inSeam: true, seamTail: false, nextReady: true });
    const region = await screen.findByRole('region', { name: 'Transition into Song 3 is playing' });
    expect(region.querySelector('.handoff-pair')).toHaveTextContent('From Song 2Into Song 3');
  });
});
