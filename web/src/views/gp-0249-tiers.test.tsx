import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/** GP-0249-01: the Listen control inventory recorded in ADR-0249. The foreground tier is always on
 * screen; the advanced tier lives inside the closed DJ controls disclosure, so it never competes with
 * playback, and nothing in either tier is missing. */

const mix = [1, 2].map((id, position) => ({
  position, song_id: id, artist: 'Test Artist', title: `Song ${id}`, duration: 20, bpm: 120, key: '8A', locked: false, seam: null,
})) as MixItem[];
const detail: SongDetail = {
  id: 1, artist: 'Test Artist', title: 'Song 1', duration: 20, bpm: 120, key: '8A', peaks: [], bar_times: [0, 8, 16],
  beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], beats_per_bar: 4, sections: [], lines: [],
};

describe('GP-0249-01 foreground and advanced Listen tiers', () => {
  it('keeps the transport in the foreground and every advanced control behind DJ controls', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail, 'GET /songs/2': { ...detail, id: 2, title: 'Song 2' } });
    const player = new SetPlayer(() => mix, () => {});
    const { container } = render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    const advanced = container.querySelector('details.dj-controls')!;
    expect(advanced).not.toHaveAttribute('open');
    // foreground tier: identity, Previous, Play/Pause, Next, Jump to the transition, volume, seek
    for (const name of ['Previous song', 'Pause', 'Next song', 'Jump to the transition']) {
      const control = screen.getByRole('button', { name });
      expect(advanced.contains(control), name).toBe(false);
    }
    expect(container.querySelector('.listen-identity .track-title')).toHaveTextContent('Song 1');
    expect(await screen.findByRole('slider', { name: 'Where in the song' })).toBeInTheDocument();
    expect(advanced.contains(screen.getByRole('slider', { name: 'Where in the song' }))).toBe(false);
    // advanced tier: display panels, visualizer style, intensity, Fullscreen lyrics, all inside the disclosure
    for (const element of [
      screen.getByRole('group', { name: 'Visible listening panels', hidden: true }),
      screen.getByRole('combobox', { name: 'Audio visualizer style', hidden: true }),
      screen.getByRole('group', { name: 'Visual intensity', hidden: true }),
      screen.getByRole('button', { name: 'Fullscreen lyrics', hidden: true }),
    ]) expect(advanced.contains(element)).toBe(true);
    // steering and transition ratings, when present, are advanced too
    for (const selector of ['.steer', '.thumbs', '.listen-request-action']) {
      const found = container.querySelector(selector);
      if (found) expect(advanced.contains(found), selector).toBe(true);
    }
  });
});
