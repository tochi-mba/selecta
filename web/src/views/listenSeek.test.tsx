import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/** UF-0374-05: the overview strip seeks from the keyboard as well as the pointer, always inside the
 * song, and says why when it can't (during a transition). */

const item: MixItem = { position: 0, song_id: 3, artist: 'A', title: 'Song', duration: 100, bpm: 120, key: '8A', locked: false, seam: null };
const detail = { id: 3, artist: 'A', title: 'Song', duration: 100, bpm: 120, key: '8A', peaks: [0.5, 0.6], sections: [], lines: [] } as unknown as SongDetail;

async function strip(songTime: number, inSeam = false) {
  fakeBackend({ 'GET /status': status(), 'GET /songs/3': detail });
  const player = new SetPlayer(() => [item], () => {});
  const seek = vi.spyOn(player, 'seek').mockResolvedValue(undefined);
  render(
    <Now status={status()} mix={[item]} mixName="Mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime, duration: 100, inSeam }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
  return { slider: await screen.findByRole('slider', { name: 'Where in the song' }), seek };
}

describe('keyboard seeking on the overview strip', () => {
  it('moves by 5 and 30 seconds and to either end, never outside the song', async () => {
    const { slider, seek } = await strip(2);
    expect(slider).toHaveAttribute('tabindex', '0');
    expect(slider).toHaveAttribute('aria-valuetext', '0:02 of 1:40, 1:38 left');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(seek.mock.calls.map(([to]) => to)).toEqual([7, 0, 32, 0, 99]);
  });

  it('near the end, a big step stops inside the song', async () => {
    const { slider, seek } = await strip(90);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(seek).toHaveBeenCalledWith(100);
  });

  it('refuses to seek during a transition and says why', async () => {
    const { slider, seek } = await strip(40, true);
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(seek).not.toHaveBeenCalled();
    expect(document.getElementById(slider.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
  });
});
