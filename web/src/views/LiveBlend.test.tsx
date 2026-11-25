import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixItem, SongDetail } from '../api';
import type { NowState } from '../player';
import { LiveBlend } from './LiveBlend';

// T-20261125-5baf: in Cloud a mix item carries no switch point, so the blend drew nothing. The
// engine's own hand-over (NowState.blend) now gives the span and the next song's decoded length.
// T-20261125-2e79: both songs are drawn on one timeline, the outgoing one from 20 s before the
// hand-over, so its lane is not only its quiet last seconds.

vi.mock('./feelBits', () => ({ useFeelPart: () => true }));
afterEach(cleanup);

const item = (song_id: number, duration: number): MixItem => ({ position: song_id, song_id, artist: 'A', title: `Song ${song_id}`, duration, bpm: null, key: null, locked: false, seam: null } as unknown as MixItem);
// 400 peaks over 200 s, so one peak is half a second: loud up to 170 s, silent after it
const detail: SongDetail = { id: 1, artist: 'A', title: 'Song 1', duration: 200, bpm: 0, key: '', peaks: Array.from({ length: 400 }, (_, index) => (index < 340 ? 1 : 0)), sections: [], lines: [] } as unknown as SongDetail;
const now = (over: Partial<NowState> = {}): NowState => ({
  phase: 'playing', position: 0, songTime: 178, duration: 200, inSeam: true, seamAt: 170, notice: '', nextReady: true,
  lastSeamKey: null, volume: 1, muted: false, blend: { window: 16, nextLength: 240, nextFrom: 0 }, ...over,
});

/** Each bar of a lane as where it stands across the drawing and how tall it is. */
const barsOf = (path: string | null | undefined) => [...(path ?? '').matchAll(/M([\d.]+) [\d.-]+v([\d.]+)/g)].map((bar) => ({ x: Number(bar[1]), height: Number(bar[2]) }));

describe('the live blend in Cloud', () => {
  it('draws both songs crossing, the incoming one from where it came in, with the line at the real time', async () => {
    const peaksOf = vi.fn(async () => Array.from({ length: 480 }, () => 0.5));
    const { container, getByText } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={peaksOf} />);
    await waitFor(() => expect(container.querySelector('.live-blend')?.getAttribute('data-incoming')).toBe('measured'));
    expect(peaksOf).toHaveBeenCalledWith(2);
    // the timeline runs from 150 s (20 s of lead-in) to 186 s (the end of a 16 s hand-over)
    const entry = (20 / 36) * 100;
    const incoming = barsOf(container.querySelector('.live-blend-in:not(.played)')?.getAttribute('d'));
    expect(incoming.length).toBeGreaterThan(10);
    expect(Math.min(...incoming.map((bar) => bar.x))).toBeGreaterThan(entry);
    expect(incoming.every((bar) => bar.height === 10)).toBe(true);
    // 178 s on that timeline
    expect(container.querySelector('.live-blend-head')?.getAttribute('x1')).toBe(((28 / 36) * 100).toFixed(2));
    expect(getByText('Song 1')).toBeTruthy();
    expect(getByText('Song 2')).toBeTruthy();
    expect(container.querySelector('.live-blend-caption')).toBeNull();
  });

  it('draws the outgoing song from before the hand-over, not just its quiet end', async () => {
    const { container } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={async () => null} />);
    await waitFor(() => expect(container.querySelector('.live-blend')).not.toBeNull());
    const outgoing = barsOf(container.querySelector('.live-blend-out:not(.played)')?.getAttribute('d'));
    const entry = (20 / 36) * 100;
    // the lead-in, loud in this song, fills the lane; its silent last seconds rest on the floor
    expect(Math.min(...outgoing.map((bar) => bar.x))).toBeLessThan(2);
    expect(outgoing.filter((bar) => bar.x < entry - 2).every((bar) => bar.height === 20)).toBe(true);
    expect(outgoing.filter((bar) => bar.x > entry + 2).every((bar) => bar.height === 0.6)).toBe(true);
  });

  it('says only this song is drawn when the next song truly cannot be read', async () => {
    const { container, getByText } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={async () => null} />);
    await waitFor(() => expect(container.querySelector('.live-blend')?.getAttribute('data-incoming')).toBe('missing'));
    expect(getByText(/only this song is drawn/)).toBeTruthy();
    expect(container.querySelector('.live-blend-in')).toBeNull();
  });

  it('says nothing about the next song while its peaks are still on their way', () => {
    const { container, queryByText } = render(<LiveBlend now={now()} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} peaksOf={() => new Promise(() => {})} />);
    expect(container.querySelector('.live-blend')?.getAttribute('data-incoming')).toBe('reading');
    expect(queryByText(/only this song is drawn/)).toBeNull();
  });

  it('draws nothing outside a hand-over', () => {
    const { container } = render(<LiveBlend now={now({ inSeam: false, songTime: 100, blend: null })} leaving={item(1, 0)} entering={item(2, 0)} detail={detail} />);
    expect(container.querySelector('.live-blend')).toBeNull();
  });
});
