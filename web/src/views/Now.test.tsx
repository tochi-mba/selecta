import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, status } from '../test/backend';
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

  it('keeps the countdown compact, preserves choices and explains lyric focus', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    const { container } = render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    fireEvent.click(container.querySelector('details.view-options > summary')!);
    const panels = screen.getByRole('group', { name: 'Visible listening panels' });
    expect(within(panels).getAllByRole('button')).toHaveLength(3);
    const countdown = within(panels).getByRole('button', { name: 'Beat countdown' });
    expect(countdown).toHaveAttribute('aria-pressed', 'true');
    expect(countdown.parentElement).toHaveClass('listen-display-toggles');
    fireEvent.click(countdown);
    expect(countdown).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(localStorage.getItem('selecta.listen') ?? '{}').timing).toBe(false);

    fireEvent.click(within(panels).getByRole('button', { name: 'Lyrics focus' }));
    expect(screen.getByText(/Lyrics focus temporarily hides the spectrum and countdown/)).toBeVisible();
    expect(within(panels).getByRole('button', { name: 'Spectrum' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Visual intensity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fullscreen lyrics' })).toBeEnabled();
    expect(player.state.phase).toBe('idle');
    window.localStorage.removeItem('selecta.listen');
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
    expect(screen.getByRole('button', { name: /Next Song.*Edit upcoming song and transition/ })).toBeInTheDocument();
  });
});

describe('missing or invalid song duration', () => {
  it('keeps a finite, disabled slider and never attempts a seek', async () => {
    fakeBackend({ 'GET /songs/1': { ...detail, duration: 0 } });
    const player = new SetPlayer(() => mix, () => {});
    const seek = vi.spyOn(player, 'seek').mockResolvedValue(undefined);
    render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 0 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    const slider = await screen.findByRole('slider', { name: 'Where in the song' });
    expect(slider).toHaveAttribute('aria-valuemax', '0');
    expect(slider).toHaveAttribute('aria-valuetext', 'Duration unknown');
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(seek).not.toHaveBeenCalled();
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
    await screen.findByRole('slider', { name: 'Where in the song' });
    // Let the view's follow-up fetches and effects settle, then take the slider that is actually
    // mounted: on a slow CI runner a late re-render could swap the element under a stale reference.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const slider = screen.getByRole('slider', { name: 'Where in the song' });
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
    // The sheet can render a tick after the click on a busy runner; wait for it like the button.
    expect(await screen.findByRole('region', { name: 'All timed lyrics, scroll manually' })).toHaveTextContent('Hello, beautiful world!');
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Audio visualizer style' }), { target: { value: 'ribbon' } });
    expect(JSON.parse(localStorage.getItem('selecta.listen') ?? '{}').spectrumShape).toBe('ribbon');
    expect(screen.getByRole('img', { name: 'Frequency ribbon - actual mixed-audio frequency levels' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Radial spectrum' })).toBeNull();
    expect(player.state.phase).toBe('idle');
    fireEvent.change(screen.getByRole('combobox', { name: 'Audio visualizer style' }), { target: { value: 'bars' } });
    expect(screen.getByRole('img', { name: 'Frequency bars - actual mixed-audio frequency levels' })).toBeInTheDocument();
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
    expect(screen.getByRole('combobox', { name: 'Audio visualizer style' })).toHaveValue('ribbon');
    expect(screen.getByRole('img', { name: 'Audio frequency visualizer paused' })).toBeInTheDocument();
    expect(player.state.phase).toBe('idle');
    window.localStorage.removeItem('selecta.listen');
  });

  it.each([
    ['aurora', 'Aurora contours'],
    ['lanes', 'Spectral lanes'],
    ['constellation', 'Frequency constellation'],
    ['waterfall', 'Recent spectrum'],
    ['skyline', 'Spectrum skyline'],
    ['threads', 'Glass threads'],
    ['pins', 'Signal pins'],
    ['matrix', 'Spectrum mosaic'],
    ['trails', 'Afterglow trails'],
    ['dunes', 'Spectral dunes'],
    ['candles', 'Signal ranges'],
    ['mesh', 'Frequency mesh'],
    ['split', 'Split flow'],
  ])('chooses and remembers %s without creating or starting audio', async (id, label) => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const player = new SetPlayer(() => mix, () => {});
    const play = vi.spyOn(player, 'playFrom');
    render(
      <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    await screen.findByText('Hello');
    fireEvent.change(screen.getByRole('combobox', { name: 'Audio visualizer style' }), { target: { value: id } });
    expect(screen.getByRole('img', { name: label + ' - actual mixed-audio frequency levels' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('selecta.listen') ?? '{}').spectrumShape).toBe(id);
    expect(play).not.toHaveBeenCalled();
    expect(player.state.phase).toBe('idle');
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

// S3-0055-04, -05 and -08: lyric fallbacks, steering failure and the exact seam a rating is about
function listen(tracks: MixItem[], more: { lastSeamKey?: string | null; notify?: (message: string) => void; setMixData?: () => void } = {}) {
  const player = new SetPlayer(() => tracks, () => {});
  return (
    <Now
      status={status()} mix={tracks} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={more.setMixData ?? (() => {})} refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20, lastSeamKey: more.lastSeamKey ?? null }}
      setView={() => {}} notify={more.notify ?? (() => {})} stage={false} toggleStage={() => {}}
    />
  );
}

describe('when there are no timed lyrics to follow', () => {
  it.each([
    ['instrumental', [], 'Instrumental'],
    [null, [], 'Lyrics haven’t been looked up yet.'],
    ['failed', [], 'Looking up lyrics for this song didn’t work. SelectaDJ will try again later.'],
    ['missing', [], 'No lyrics found for this song.'],
  ])('says why for a %s song, and invents no timing', async (lyricStatus, lines, words) => {
    fakeBackend({ 'GET /songs/1': { ...detail, lines, lyric_status: lyricStatus } });
    const { container } = render(view(2.5));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(container.querySelector('.current-word')).toBeNull();
  });

  it('labels untimed lyrics as untimed', async () => {
    fakeBackend({ 'GET /songs/1': { ...detail, lyric_status: 'plain', lines: [{ start: 0, end: 0, text: 'Plain words only' }] } });
    render(listen(mix));
    expect(await screen.findByText('Untimed lyrics - word timing unavailable.')).toBeInTheDocument();
  });
});

describe('steering that fails', () => {
  it('keeps the planned next song, says what went wrong, and can be pressed again', async () => {
    const tracks = [mix[0], { ...mix[0], position: 1, song_id: 2, title: 'Next Song' }];
    let swaps = 0;
    fakeBackend({
      'GET /songs/1': detail,
      'POST /mix/1/swap': () => { swaps += 1; return new Reply(409, { detail: 'Nothing else fits here right now.' }); },
    });
    const setMixData = vi.fn();
    render(listen(tracks, { setMixData }));
    fireEvent.click(screen.getByRole('button', { name: 'Bigger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing else fits here right now. Nothing has changed, so the plan above still stands.');
    expect(setMixData).not.toHaveBeenCalled();
    expect(screen.getAllByText('Next Song').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Calmer' })).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(screen.getByRole('button', { name: 'Calmer' }));
    await waitFor(() => expect(swaps).toBe(2));
  });
});

describe('rating what was just heard', () => {
  it('rates the transition that just played, by its key, and explains what was measured', async () => {
    const seamed: MixItem[] = [mix[0], { ...mix[0], position: 1, song_id: 2, title: 'Next Song', seam: { settings: { move: 'bass_swap_blend' }, state: { status: 'ready', key: 'next-k', passed: true, label: 'Blend', why: 'Close in tempo and key', checks: [{ name: 'beat', passed: true, text: 'The beats line up', value: '' }] } } as never }];
    const calls = fakeBackend({ 'GET /songs/1': detail, 'POST /seams/played-k/rate': {} });
    const notify = vi.fn();
    render(listen(seamed, { lastSeamKey: 'played-k', notify }));
    const thumbs = within(screen.getByRole('group', { name: 'Rate that transition' }));
    fireEvent.click(thumbs.getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Noted. More like that.'));
    expect(calls.filter((call) => call.method === 'POST').map((call) => [call.path, call.body])).toEqual([['/seams/played-k/rate', { rating: 'good' }]]);
    fireEvent.click(screen.getByText('Why this transition?'));
    expect(screen.getByText('Close in tempo and key')).toBeInTheDocument();
    expect(screen.getByText('The beats line up')).toBeInTheDocument();
  });
});
