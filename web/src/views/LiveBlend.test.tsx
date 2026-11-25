import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixItem, SongDetail } from '../api';
import type { NowState } from '../player';
import { LiveBlend } from './LiveBlend';

// T-20261125-5baf: in Cloud a mix item carries no switch point, so the blend drew nothing. The
// engine's own hand-over (NowState.blend) now gives the span and the next song's decoded length.

vi.mock('./feelBits', () => ({ useFeelPart: () => true }));
afterEach(cleanup);

const item = (song_id: number, duration: number): MixItem => ({ position: song_id, song_id, artist: 'A', title: `Song ${song_id}`, duration, bpm: null, key: null, locked: false, seam: null } as unknown as MixItem);
const detail: SongDetail = { id: 1, artist: 'A', title: 'Song 1', duration: 200, bpm: 0, key: '', peaks: Array.from({ length: 400 }, (_, index) => (index % 7) / 7), sections: [], lines: [] } as unknown as SongDetail;
const now = (over: Partial<NowState> = {}): NowState => ({
  phase: 'playing', position: 0, songTime: 178, duration: 200, inSeam: true, seamAt: 170, notice: '', nextReady: true,
  lastSeamKey: null, volume: 1, muted: false, blend: { window: 16, nextLength: 240, nextFrom: 0 }, ...over,
});

describe('the live blend in Cloud', () => {
  it('draws both songs crossing at the real hand-over progress', async () => {
    const peaksOf = vi.fn(async () => Array.from({ length: 400 }, () => 0.5));
    const { container } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={peaksOf} />);
    await waitFor(() => expect(container.querySelector('.live-blend')?.getAttribute('data-incoming')).toBe('measured'));
    expect(peaksOf).toHaveBeenCalledWith(2);
    // 8 s into a 16 s hand-over
    expect(container.querySelector('.live-blend-head')?.getAttribute('x1')).toBe('50.00');
  });

  it('draws the playing song only, and says so, when the next song cannot be read', async () => {
    const { container, getByText } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={async () => null} />);
    await waitFor(() => expect(container.querySelector('.live-blend')).not.toBeNull());
    expect(container.querySelector('.live-blend')?.getAttribute('data-incoming')).toBe('missing');
    expect(getByText(/only this song is drawn/)).toBeTruthy();
  });

  it('draws nothing outside a hand-over', () => {
    const { container } = render(<LiveBlend now={now({ inSeam: false, songTime: 100, blend: null })} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} />);
    expect(container.querySelector('.live-blend')).toBeNull();
  });
});
