import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MixItem } from '../api';
import { NowState, SetPlayer } from '../player';
import { parseRoute } from '../router';
import { Shell } from '../shell/Shell';
import { fakeBackend, status } from '../test/backend';
import { Now } from '../views/Now';
import { playLabel, SEAM_LABEL, songArtist, songTitle, timeLabel, transportClock } from './transportWords';

/** UF-0373-02 and UF-0373-08: one player state reads the same on the mini-player and on Listen, and
 * a stop the listener didn't ask for says why on every page. */

const song = (title: string, artist: string): MixItem => ({
  position: 0, song_id: 1, artist, title, duration: 200, bpm: 120, key: '8A', locked: false, seam: null,
});

function mini(item: MixItem, now: NowState) {
  const player = new SetPlayer(() => [item], () => {});
  return render(
    <Shell route={parseRoute('/library')} player={player} now={now} song={item} showPlayer hasMix hasNext
      stage={false} waitingRequests={0} onRequests={() => {}} onHelp={() => {}}>
      <main id="main">Library</main>
    </Shell>,
  );
}

function listen(item: MixItem, now: NowState) {
  fakeBackend({ 'GET /status': status(), [`GET /songs/${item.song_id}`]: { id: item.song_id, peaks: [], sections: [], lines: [], duration: now.duration } });
  const player = new SetPlayer(() => [item], () => {});
  return render(
    <Now status={status()} mix={[item]} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={now} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

const state = (more: Partial<NowState>): NowState => ({ ...new SetPlayer(() => [], () => {}).state, position: 0, ...more });

afterEach(cleanup);

describe('one set of transport words', () => {
  it('rounds down like a media player and never reads NaN, and says an unknown length', () => {
    expect(transportClock(89.9)).toBe('1:29');
    expect(transportClock(Number.NaN)).toBe('0:00');
    expect(timeLabel(61.2, 200)).toBe('1:01 / 3:20');
    expect(timeLabel(5, 0)).toBe('0:05 / unknown duration');
    expect(timeLabel(5, Number.POSITIVE_INFINITY)).toBe('0:05 / unknown duration');
    expect(['playing', 'loading', 'paused', 'idle'].map((phase) => playLabel(phase as NowState['phase']))).toEqual(['Pause', 'Loading song', 'Resume', 'Play']);
    expect(songTitle({ title: '' })).toBe('Untitled');
    expect(songArtist({ artist: null })).toBe('Unknown artist');
  });

  for (const phase of ['playing', 'paused', 'loading'] as const) {
    it(`the mini-player and Listen agree on song, phase and time while ${phase}`, async () => {
      const item = song('', '');
      const now = state({ phase, songTime: 89.6, duration: 200 });
      const { unmount } = mini(item, now);
      const bar = screen.getByRole('complementary');
      expect(within(bar).getByText('Untitled')).toBeInTheDocument();
      expect(bar).toHaveTextContent(`Unknown artist · ${timeLabel(89.6, 200)}`);
      expect(within(bar).getByRole('button', { name: playLabel(phase) })).toBeInTheDocument();
      unmount();

      listen(item, now);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled');
      expect(screen.getByText('Unknown artist')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: playLabel(phase) })).toBeInTheDocument();
      expect(await screen.findByText(timeLabel(89.6, 200))).toBeInTheDocument();
    });
  }

  it('both say a transition is playing with the same words', () => {
    const item = song('Song A', 'Artist A');
    const now = state({ phase: 'playing', songTime: 30, duration: 200, inSeam: true });
    const { unmount } = mini(item, now);
    expect(screen.getByRole('complementary', { name: 'Playing transition' })).toHaveTextContent(SEAM_LABEL);
    unmount();
    listen(item, now);
    expect(document.querySelector('.listen-identity .eyebrow')).toHaveTextContent(SEAM_LABEL);
  });

  it('an interrupted output says why on the mini-player as well as on Listen, and only while stopped', () => {
    const item = song('Song A', 'Artist A');
    const notice = 'Audio output changed. Press play to reconnect the sound.';
    const { unmount, rerender } = mini(item, state({ phase: 'paused', songTime: 30, duration: 200, notice }));
    expect(within(screen.getByRole('complementary')).getByRole('status')).toHaveTextContent(notice);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    const player = new SetPlayer(() => [item], () => {});
    rerender(
      <Shell route={parseRoute('/library')} player={player} now={state({ phase: 'playing', songTime: 31, duration: 200, notice })} song={item}
        showPlayer hasMix hasNext stage={false} waitingRequests={0} onRequests={() => {}} onHelp={() => {}}>
        <main id="main">Library</main>
      </Shell>,
    );
    expect(within(screen.getByRole('complementary')).queryByRole('status')).toBeNull();
    unmount();
    listen(item, state({ phase: 'paused', songTime: 30, duration: 200, notice }));
    expect(screen.getByText(notice)).toBeInTheDocument();
  });
});
