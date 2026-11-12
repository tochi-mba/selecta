import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Now } from './Now';

/** UF-0374-06: Up Next never promises a transition that hasn't been made. A planned or pending one is
 * called planned, says what happens if it isn't ready, and only a ready seam gets a countdown. */

const detail = { id: 1, artist: 'Artist 1', title: 'Song 1', duration: 200, bpm: 120, key: '8A', peaks: [], sections: [], lines: [], bar_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40], beat_times: Array.from({ length: 80 }, (_, i) => i / 2), beats_per_bar: 4 } as unknown as SongDetail;

function listen(mix: MixItem[], nextReady: boolean) {
  fakeBackend({ 'GET /status': status(), 'GET /songs/1': detail });
  const player = new SetPlayer(() => mix, () => {});
  render(
    <Now status={status()} mix={mix} mixName="Mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 4, duration: 200, nextReady, seamAt: nextReady ? 30 : null }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

describe('Up Next only promises what is ready', () => {
  it('a transition still being made is planned, with what happens if it is late', async () => {
    listen(songs(seam('rendering', 'a')), false);
    const next = screen.getByText('Up Next').closest('section')!;
    expect(within(next).getByText(/It hasn’t been made yet, so what plays can still change/)).toBeInTheDocument();
    expect(within(next).getByText(/this song plays on and the next one fades in/)).toBeInTheDocument();
    expect(await screen.findByText('Preparing the hand-off')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('a ready transition gets a countdown on the song clock, and no planned caveat', async () => {
    listen(songs(seam('ready', 'a', { label: 'Bass swap' })), true);
    const next = screen.getByText('Up Next').closest('section')!;
    expect(within(next).queryByText(/It hasn’t been made yet/)).toBeNull();
    expect(await screen.findByRole('timer')).toHaveAccessibleName(/until the transition/);
  });

  // T0121: a transition whose render failed is never counted down or called planned; the fade that
  // will really play and the way to choose another are said instead.
  it('a failed transition says the music carries on and how to choose another, with no countdown', async () => {
    listen(songs(seam('failed', 'a', { error: 'The render stopped part way.' })), false);
    const next = screen.getByText('Up Next').closest('section')!;
    expect(within(next).getByText(/this song plays on and the next one fades in, so the music doesn’t stop/)).toBeInTheDocument();
    expect(within(next).getByText(/falls back to its own pick\. You can choose another in Edit/)).toBeInTheDocument();
    expect(within(next).queryByText(/It hasn’t been made yet/)).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
  });
});
