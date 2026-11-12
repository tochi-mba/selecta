import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

// S31-0080-09: found with real NVDA 2026.3.1 on 2026-11-12. With focus on the song slider while the
// music played, NVDA read "0:13 of 1:29, 1:16 left" twice a second, because the slider's value
// ticked with the clock. A focused slider now holds its spoken value until the listener seeks.

const song: MixItem = { position: 0, song_id: 1, artist: 'Artist 1', title: 'Song 1', duration: 20, bpm: 120, key: '8A', locked: false, seam: null };
const detail: SongDetail = {
  id: 1, artist: 'Artist 1', title: 'Song 1', duration: 20, bpm: 120, key: '8A',
  peaks: [], bar_times: [], beat_times: [], beats_per_bar: 4, sections: [], lines: [],
};

function view(songTime: number, player: SetPlayer) {
  return (
    <Now status={status()} mix={[song]} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, duration: 20, songTime }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

describe('S31-0080-09 the song slider does not read the clock aloud', () => {
  it('follows the music while unfocused, holds still while focused, and moves when the listener seeks', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => [song], () => {});
    const { rerender } = render(view(2, player));
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:02 of 0:20, 0:18 left');

    rerender(view(3, player));
    expect(slider).toHaveAttribute('aria-valuetext', '0:03 of 0:20, 0:17 left');

    fireEvent.focus(slider);
    rerender(view(4, player));
    rerender(view(5, player));
    expect(slider).toHaveAttribute('aria-valuetext', '0:03 of 0:20, 0:17 left');
    expect(slider).toHaveAttribute('aria-valuenow', '3');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:10 of 0:20, 0:10 left');

    fireEvent.blur(slider);
    rerender(view(11, player));
    expect(slider).toHaveAttribute('aria-valuetext', '0:11 of 0:20, 0:09 left');
  });
});
