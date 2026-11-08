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
    const details = container.querySelector('details.dj-controls');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('DJ controls')).toBeVisible();
    expect(screen.getByText('Display options')).toBeInTheDocument();
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
    const djControls = bigger.closest('details');
    expect(djControls).toHaveClass('dj-controls');
    expect(djControls).not.toHaveAttribute('open');
    expect(screen.getByText('Up Next')).toBeVisible();
    bigger.focus();
    fireEvent.click(bigger);
    await waitFor(() => expect(writes).toBe(1));
    // told it has to wait, but still in the tab order: disabling the button someone just pressed
    // would throw a keyboard or screen reader user back to the top of the page
    expect(calmer).toHaveAttribute('aria-disabled', 'true');
    expect(calmer).toBeEnabled();
    expect(bigger).toBeEnabled();
    expect(bigger).toHaveFocus();
    fireEvent.click(calmer);
    expect(writes).toBe(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(calmer).not.toHaveAttribute('aria-disabled'));
    expect(writes).toBe(1);
    expect(bigger).toHaveFocus();
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

describe('pointer seeking', () => {
  it('previews the target without seeking until release', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    const seek = vi.spyOn(player, 'seek').mockResolvedValue(undefined);
    render(
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
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);
    fireEvent.pointerDown(slider, { pointerId: 3, isPrimary: true, button: 0, clientX: 100 });
    expect(slider.querySelector('.scrub-ghost')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(seek).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 3, isPrimary: true, button: 0, clientX: 100 });
    expect(slider.querySelector('.scrub-ghost')).toBeNull();
    expect(seek).toHaveBeenCalledWith(10);
  });
});

describe('listener-controlled presentation', () => {
  it('can read a full static lyric sheet and resume following without affecting audio', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    const button = await screen.findByRole('button', { name: 'Read all lyrics' });
    fireEvent.click(button);
    expect(screen.getByRole('region', { name: 'All timed lyrics, scroll manually' })).toHaveTextContent('Hello, beautiful world!');
    fireEvent.click(screen.getByRole('button', { name: 'Resume lyric follow' }));
    expect(screen.queryByRole('region', { name: 'All timed lyrics, scroll manually' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Read all lyrics' })).toBeInTheDocument();
  });

  it('keeps visual intensity independent from playback and remembers the choice', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    const { container } = render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    await screen.findByText('Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Quiet visuals' }));
    expect(container.querySelector('.music-visualizer')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('selecta.listen') ?? '{}').intensity).toBe('quiet');
    fireEvent.click(screen.getByRole('button', { name: 'Focused visuals' }));
    expect(container.querySelector('.music-visualizer.focused')).toBeInTheDocument();
    expect(player.state.phase).toBe('idle');
  });
});


describe('creative Listen states grounded in audio and known timing', () => {
  it('lets the listener choose a full-width real-data frequency ribbon without changing playback', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    await screen.findByText('Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Frequency ribbon' }));
    expect(JSON.parse(localStorage.getItem('selecta.listen') ?? '{}').spectrumShape).toBe('ribbon');
    expect(screen.getByRole('img', { name: 'Horizontal ribbon of real audio frequency levels' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Radial spectrum' })).toBeNull();
    expect(player.state.phase).toBe('idle');
    fireEvent.click(screen.getByRole('button', { name: 'Frequency bars' }));
    expect(screen.getByRole('img', { name: 'Bar real audio frequency levels' })).toBeInTheDocument();
  });

  it('converts previously saved radial visuals to the horizontal ribbon without changing playback', async () => {
    window.localStorage.setItem('selecta.listen', JSON.stringify({ spectrumShape: 'radial' }));
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'paused', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    await screen.findByText('Hello');
    expect(screen.getByRole('button', { name: 'Frequency ribbon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Audio frequency visualizer paused' })).toBeInTheDocument();
    expect(player.state.phase).toBe('idle');
    window.localStorage.removeItem('selecta.listen');
  });

  it('uses chronological seconds when the next handoff has no valid beat grid', async () => {
    fakeBackend({ 'GET /songs/1': { ...detail, bar_times: [], beat_times: [] } });
    const next: MixItem = { ...mix[0], song_id: 2, position: 1, title: 'Next song',
      seam: { settings: { move: 'auto' }, state: { status: 'ready', key: 'seam-1' } } };
    const set = [mix[0], next];
    const player = new SetPlayer(() => set, () => {});
    render(
      <Now status={status()} mix={set} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20, seamAt: 12, nextReady: true }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    expect(await screen.findByText(/until the hand-off/)).toBeInTheDocument();
    expect(screen.getByText(/Beat grid unavailable, so time is shown/)).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
  });
});
