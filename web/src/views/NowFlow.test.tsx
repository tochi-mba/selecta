import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

// Flow ADR-0213/0214: the clock, waveform, markers and hand-off words come only from what is known.

const song = (id: number, seam: MixItem['seam'] = null): MixItem => ({
  position: id - 1, song_id: id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 20,
  bpm: 120, key: '8A', locked: false, seam,
});

const detail: SongDetail = {
  id: 1, artist: 'Artist 1', title: 'Song 1', duration: 20, bpm: 120, key: '8A',
  peaks: [], bar_times: [], beat_times: [], beats_per_bar: 4, sections: [], lines: [],
};

function show(mix: MixItem[], now: Partial<SetPlayer['state']>, stage = false) {
  const player = new SetPlayer(() => mix, () => {});
  return render(
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, duration: 20, ...now }}
      setView={() => {}} notify={() => {}} stage={stage} toggleStage={() => {}} />,
  );
}

describe('SF-0214-01 clock semantics', () => {
  it('reads time, length and time left from the player clock', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    show([song(1)], { songTime: 2 });
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:02 of 0:20, 0:18 left');
  });
});

describe('SF-0214-05/06 waveform and markers only from analysis', () => {
  it('draws no waveform, bars, sections or seam mark when analysis has none', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    show([song(1)], { songTime: 2, seamAt: null });
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    expect(slider.querySelector('path.unplayed')?.getAttribute('d')).toBe('');
    expect(slider.querySelectorAll('.bar-ticks i')).toHaveLength(0);
    expect(slider.querySelectorAll('.sections span')).toHaveLength(0);
    expect(slider.querySelector('.seam-mark')).toBeNull();
  });

  it('draws one stroke per measured peak and marks only known sections and the planned seam', async () => {
    const peaks = [0.1, 0.9, 0.5, 0.3];
    fakeBackend({ 'GET /songs/1': { ...detail, peaks, bar_times: [0, 8, 16], sections: [{ label: 'chorus', start: 0, end: 16 }] } });
    show([song(1)], { songTime: 2, seamAt: 15 });
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    const strokes = slider.querySelector('path.unplayed')?.getAttribute('d')?.match(/M/g) ?? [];
    expect(strokes).toHaveLength(peaks.length);
    expect(slider.querySelectorAll('.bar-ticks i')).toHaveLength(3);
    expect(slider.querySelectorAll('.sections span')).toHaveLength(1);
    expect(slider.querySelector('.seam-mark')).toHaveAttribute('title', 'Seam at 0:15');
  });
});

describe('SF-0213-05 shared words only on a proven word hand-off', () => {
  const seamed = (state: Partial<NonNullable<MixItem['seam']>['state']>) => [
    song(1),
    song(2, { settings: { move: 'word_cut', phrase: 'hold on' }, state: { status: 'ready', key: 'k', style: 'word_cut', switch_at: 4, ...state } }),
  ];
  const playing = { songTime: 12, seamAt: 10, inSeam: true, nextReady: true };

  it('names the shared words while a rendered word move plays', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    show(seamed({}), playing, true);
    expect(await screen.findByText('On the shared words “hold on”')).toBeInTheDocument();
  });

  it.each([
    ['a fallback', { fell_back: true }],
    ['another move', { style: 'bass_swap_blend' }],
    ['an unfinished render', { status: 'rendering' as const }],
  ])('says nothing about words for %s', async (_, state) => {
    fakeBackend({ 'GET /songs/1': detail });
    show(seamed(state), playing, true);
    await screen.findByText('Transition in progress');
    expect(screen.queryByText(/shared words/)).toBeNull();
  });
});
