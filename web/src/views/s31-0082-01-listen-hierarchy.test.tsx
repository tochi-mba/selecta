import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { NowState, SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { ListenEmpty } from './ListenEmpty';
import { Now } from './Now';

/**
 * ADR-0082 (S31-0082-01): in every Listen state (playing, paused, loading, a playback problem and
 * nothing lined up) the song, the artist, where the song is, Play/Pause and Next are the first things
 * on the page, the main button says what it will do, and the optional controls come after the
 * transport, folded away and never styled as the main action.
 */

const mix: MixItem[] = [
  { position: 0, song_id: 1, artist: 'Ada Lane', title: 'First Light', duration: 200, bpm: 120, key: '8A', locked: false, seam: null },
  { position: 1, song_id: 2, artist: 'Bo Reyes', title: 'Second Wind', duration: 210, bpm: 122, key: '9A', locked: false, seam: null },
];

const detail: SongDetail = {
  id: 1, artist: 'Ada Lane', title: 'First Light', duration: 200, bpm: 120, key: '8A', peaks: [0.2, 0.5, 0.4],
  bar_times: [0, 2, 4, 6], beat_times: [0, 0.5, 1, 1.5, 2], beats_per_bar: 4, sections: [], lines: [],
};

function listen(state: Partial<NowState>) {
  fakeBackend({ 'GET /songs/1': detail });
  const player = new SetPlayer(() => mix, () => {});
  return render(
    <Now
      status={status()} mix={mix} mixName="Sunday mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, position: 0, duration: 200, ...state }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}}
    />,
  );
}

/** Where one element sits relative to another in reading order. */
const before = (first: Element, second: Element) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('S31-0082-01 Listen keeps its primary hierarchy in every state', () => {
  it.each([
    ['playing', { phase: 'playing', songTime: 30 }, 'Pause'],
    ['paused', { phase: 'paused', songTime: 30 }, 'Resume'],
    ['loading', { phase: 'loading', songTime: 0 }, 'Loading song'],
    ['a playback problem', { phase: 'paused', songTime: 30, notice: 'The sound stopped while this page was away. Press play to continue.' }, 'Resume'],
  ] as const)('%s: song, artist, progress, the main button and Next lead the page', async (_state, state, main) => {
    const { container } = listen(state as Partial<NowState>);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('First Light');
    const artist = container.querySelector('.listen-identity .artist')!;
    expect(artist).toHaveTextContent('Ada Lane');
    const button = screen.getByRole('button', { name: main });
    expect(button).toHaveClass('primary');
    const next = screen.getByRole('button', { name: 'Next song' });
    const progress = await screen.findByRole('slider', { name: 'Where in the song' });

    // reading order: who, then the transport, then where in the song
    expect(before(title, artist)).toBe(true);
    expect(before(artist, button)).toBe(true);
    expect(before(button, next)).toBe(true);
    expect(before(next, progress)).toBe(true);

    // only one main action on the page; optional controls come later and start folded away
    expect(container.querySelectorAll('main .primary')).toHaveLength(1);
    const optional = container.querySelector('details.dj-controls');
    if (optional) {
      expect(optional).not.toHaveAttribute('open');
      expect(before(progress, optional)).toBe(true);
      expect(optional.querySelector('.primary')).toBeNull();
    }
  });

  it('a playback problem is said in words next to the transport, without taking over the page', () => {
    listen({ phase: 'paused', songTime: 30, notice: 'Audio output changed. Press play to reconnect the sound.' });
    const notice = screen.getAllByRole('status').find((element) => element.textContent?.includes('Audio output changed'));
    expect(notice).toHaveClass('notice');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('First Light');
  });

  it('paused names itself next to the mix, so it is not mistaken for playing', () => {
    const { container } = listen({ phase: 'paused', songTime: 30 });
    expect(container.querySelector('.listen-identity .eyebrow')).toHaveTextContent('Paused · Sunday mix');
  });

  it('nothing lined up: one plain heading and one main way forward', () => {
    fakeBackend({});
    const { container } = render(<ListenEmpty />);
    const main = container.querySelector('main')!;
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Nothing is lined up yet.');
    const primary = main.querySelectorAll('.primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Explore mixes');
    expect(within(main).getByRole('link', { name: 'Choose a song' })).not.toHaveClass('primary');
  });
});
