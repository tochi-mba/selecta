import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now, transitionCount } from './Now';

const mix: MixItem[] = [
  {
    position: 0,
    song_id: 1,
    artist: 'Test Artist',
    title: 'Test Song',
    duration: 20,
    bpm: 120,
    key: '8A',
    locked: false,
    seam: null,
  },
];

const detail: SongDetail = {
  id: 1,
  artist: 'Test Artist',
  title: 'Test Song',
  duration: 20,
  bpm: 120,
  key: '8A',
  peaks: [],
  bar_times: [0, 8, 16, 24],
  beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
  beats_per_bar: 4,
  sections: [],
  lines: [
    {
      start: 1,
      end: 4,
      text: 'Hello, beautiful world!',
      words: [
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 3, end: 4 },
      ],
    },
  ],
};

function view(time: number) {
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Now
      status={status()}
      mix={mix}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position: 0, songTime: time, duration: 20 }}
      setView={() => {}}
      notify={() => {}}
      stage
      toggleStage={() => {}}
    />
  );
}

describe('word focus on the Now and Stage screens', () => {
  it('follows the current playback time and keeps the lyric punctuation', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const rendered = render(view(2.5));
    expect(await screen.findByText('Hello')).toHaveTextContent('Hello');
    expect(screen.getByText('beautiful')).toHaveClass('current-word');
    expect(screen.getByText('beautiful').closest('p')).toHaveTextContent('Hello, beautiful world!');

    rendered.rerender(view(3.5));
    expect(screen.getByText('world')).toHaveClass('current-word');
    expect(screen.getByText('beautiful')).not.toHaveClass('current-word');
  });

  it('keeps line lyrics visible when word timing is unavailable', async () => {
    fakeBackend({ 'GET /songs/1': { ...detail, lines: [{ start: 1, end: 4, text: 'No word timing' }] } });
    render(view(2.5));
    const firstWord = await screen.findByText('No');
    expect(firstWord.closest('p')).toHaveTextContent('No word timing');
    expect(firstWord).not.toHaveClass('current-word');
  });
});

describe('listener display options', () => {
  it('keeps expert view controls discoverable without competing with playback', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    const { container } = render(
      <Now
        status={status()}
        mix={mix}
        mixName="Test mix"
        canUndo={false}
        refreshMix={() => {}}
        setMixData={() => {}}
        refreshStatus={() => {}}
        player={player}
        now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
    const details = container.querySelector('details.view-options');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('Display options')).toBeVisible();
    await screen.findByText('Hello');
  });
});

describe('safe next-song steering', () => {
  it('blocks overlapping steering presses until the first server change finishes', async () => {
    let finish: () => void = () => {};
    let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/mix/1/swap') && init?.method === 'POST') {
        writes += 1;
        await new Promise<void>((done) => { finish = done; });
        return new Response(JSON.stringify({ mix: [mix[0], { ...mix[0], position: 1, song_id: 2, title: 'New Next' }] }), { status: 200 });
      }
      if (url.includes('/songs/1')) return new Response(JSON.stringify(detail), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const tracks = [mix[0], { ...mix[0], position: 1, song_id: 2, title: 'Next Song' }];
    const player = new SetPlayer(() => tracks, () => {});
    const notify = vi.fn();
    render(
      <Now
        status={status()}
        mix={tracks}
        mixName="Test mix"
        canUndo={false}
        refreshMix={() => {}}
        setMixData={() => {}}
        refreshStatus={() => {}}
        player={player}
        now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}}
        notify={notify}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    const bigger = screen.getByRole('button', { name: 'Bigger' });
    const calmer = screen.getByRole('button', { name: 'Calmer' });
    fireEvent.click(bigger);
    await waitFor(() => expect(writes).toBe(1));
    expect(calmer).toBeDisabled();
    fireEvent.click(calmer);
    expect(writes).toBe(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(calmer).toBeEnabled());
    expect(writes).toBe(1);
    expect(notify).toHaveBeenCalled();
  });
});

describe('beat-grid transition countdown', () => {
  it('follows changing bar lengths instead of extrapolating the average BPM', () => {
    const varying = { ...detail, bar_times: [0, 8, 15, 21], beat_times: [0, 2, 4, 6, 8, 9.75, 11.5, 13.25, 15, 16.5, 18, 19.5, 21] };
    expect(transitionCount(varying, 11.6, 21)).toMatchObject({ aligned: true, bars: 2, barNumber: 2, beatInBar: 3 });
    expect(transitionCount(varying, 15.1, 21)).toMatchObject({ bars: 1, barNumber: 3, beatInBar: 1 });
    expect(transitionCount(varying, 15.1, 19.5)).toMatchObject({ aligned: false, beats: 3 });
    expect(transitionCount({ ...detail, beat_times: [] }, 3, 16)).toBeNull();
  });
  it('shows bars and the current beat against the analyzed grid', async () => {
    const set = [
      mix[0],
      {
        ...mix[0], position: 1, song_id: 2, title: 'Next Song',
        seam: { settings: {}, state: { status: 'ready' as const, key: 'ready-seam' } },
      },
    ];
    const player = new SetPlayer(() => set, () => {});
    fakeBackend({ 'GET /songs/1': detail });
    render(
      <Now
        status={status()}
        mix={set}
        mixName="Test mix"
        canUndo={false}
        refreshMix={() => {}}
        setMixData={() => {}}
        refreshStatus={() => {}}
        player={player}
        now={{ ...player.state, phase: 'playing', position: 0, songTime: 3, duration: 20, seamAt: 16, nextReady: true }}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    const timer = await screen.findByRole('timer');
    expect(timer).toHaveAccessibleName('2 bars until the transition; beat 2 of 4');
    expect(timer).toHaveTextContent('02');
    expect(timer).toHaveTextContent('Bar 1');
    expect(timer).toHaveTextContent('Next Song');
    expect(screen.getByRole('button', { name: 'Edit upcoming song Next Song and its transition' })).toBeInTheDocument();
  });
});
