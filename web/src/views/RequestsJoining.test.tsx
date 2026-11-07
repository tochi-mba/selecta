import { connectMainPlayer } from '../audio/focus';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs } from '../test/backend';
import { ComingSongs, Requests, RequestsContext, RequestsState, requestWords } from './Requests';

const row = (more: Record<string, unknown> = {}) => ({ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, ...more });
const playing = (mix: MixItem[]) => {
  const state = { phase: 'playing', position: 0, duration: 200, songTime: 20, inSeam: false };
  return { mix, player: { state, togglePause: vi.fn(async () => {}) } as unknown as SetPlayer, onMix: vi.fn() };
};
const found = (id: number, title: string) => ({ id, title, artist: `${title} artist`, genre: null, duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false });
const search = () => screen.getByRole('combobox', { name: 'Request a song' });

describe('a request on its way into the mix', () => {
  const state = (rows: unknown[], more: Record<string, unknown> = {}) => ({
    requests: rows,
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
    ...more,
  }) as unknown as RequestsState;
  const show = (value: RequestsState, after = 2) => render(
    <RequestsContext.Provider value={value}><ol><ComingSongs afterSongId={after} /></ol></RequestsContext.Provider>,
  );

  it('shows where it’s going, faded, and says it isn’t ready', () => {
    const { container } = show(state([row({ stage: 'preparing', after_id: 2, seconds: 170 })]));
    expect(container.querySelector('li.song.coming')).toBeInTheDocument();
    expect(screen.getByText('Wanted')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Getting it ready · about 3 minutes')).toBeInTheDocument();
  });

  it('can’t be played, because it isn’t in the mix yet', () => {
    show(state([row({ stage: 'preparing', after_id: 2 })]));
    expect(screen.queryByRole('button', { name: /Play/ })).toBeNull();
    expect(screen.getAllByRole('listitem')[1]).toHaveAccessibleName(/won’t play until it’s ready/);
  });

  it('only shows at its own place', () => {
    const { container } = show(state([row({ stage: 'preparing', after_id: 3 })]));
    expect(container.querySelector('li')).toBeNull();
  });

  it('shows a bridge as well, in the order they’ll play', () => {
    show(state([row({ stage: 'preparing', after_id: 2, route: [{ id: 8, title: 'Bridge', artist: 'Someone' }, { id: 9, title: 'Wanted', artist: 'Artist' }] })]));
    const rows = screen.getAllByRole('listitem').slice(1);
    expect(rows[0]).toHaveTextContent('Bridge');
    expect(rows[0]).toHaveTextContent('Bridge to Wanted');
    expect(rows[1]).toHaveTextContent('Requested');
  });

  it('stays out of the timeline until there’s a spot, or an answer', () => {
    const { container } = show(state([
      row({ id: 1, stage: 'searching', after_id: 2 }),
      row({ id: 2, stage: 'approve', after_id: 2 }),
      row({ id: 3, waiting_on: 'analysis', after_id: 2 }),
    ]));
    expect(container.querySelector('li')).toBeNull();
  });

  it('shows straight after a yes to its bridge', () => {
    const { container } = show(state([row({ stage: 'approve', bridge_choice: true, after_id: 2 })]));
    expect(container.querySelector('li.song.coming')).toBeInTheDocument();
  });

  it('isn’t shown once nothing is playing, since the spot depends on where playback is', () => {
    const playback = playing(songs(undefined, undefined));
    (playback.player.state as { phase: string }).phase = 'idle';
    const { container } = show(state([row({ stage: 'preparing', after_id: 2 })], { playback }));
    expect(container.querySelector('li')).toBeNull();
  });

  it('can be cancelled from the timeline', () => {
    const value = state([row({ stage: 'preparing', after_id: 2 })]);
    show(value);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request for Wanted' }));
    expect(value.cancel).toHaveBeenCalled();
  });
});

describe('transitions on their way in', () => {
  const seams = [
    { from: 'Song 2', to: 'Wanted', key: 'in', status: 'ready', label: 'Blend' },
    { from: 'Wanted', to: 'Song 3', key: 'out', status: 'rendering', label: 'Delay throw' },
  ];
  const value = (transitions: { from: string; to: string; key: string; status: string; label?: string }[] = seams) => ({
    requests: [row({ stage: 'preparing', after_id: 2, transitions })],
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
  }) as unknown as RequestsState;
  const show = (state: RequestsState) => render(
    <RequestsContext.Provider value={state}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
  );

  it('sit either side of the song, in playing order', () => {
    show(value());
    const rows = screen.getAllByRole('listitem').slice(1);
    expect(rows[0]).toHaveTextContent('Blend');
    expect(rows[1]).toHaveTextContent('Wanted');
    expect(rows[2]).toHaveTextContent('Delay throw');
  });

  it('are solid once done, and faded until then', () => {
    const { container } = show(value());
    const [done, waiting] = [...container.querySelectorAll('li.coming-seam')];
    expect(done).toHaveClass('done');
    expect(waiting).not.toHaveClass('done');
    expect(done).toHaveTextContent('Ready');
    expect(waiting).toHaveTextContent('Rendering…');
  });

  it('go solid by themselves as they finish', () => {
    const { container, rerender } = show(value());
    expect(container.querySelectorAll('li.coming-seam.done')).toHaveLength(1);
    rerender(
      <RequestsContext.Provider value={value(seams.map((seam) => ({ ...seam, status: 'ready' })))}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
    );
    expect(container.querySelectorAll('li.coming-seam.done')).toHaveLength(2);
  });

  it('can be heard once done, and pause the mix while you do', () => {
    const pause = vi.fn();
    connectMainPlayer({ isPlaying: () => true, pause, resume: vi.fn() });
    const { container } = show(value());
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const audio = container.querySelector('audio')!;
    expect(audio).toHaveAttribute('src', '/api/seams/in/preview');
    fireEvent.play(audio);
    expect(pause).toHaveBeenCalled();
    connectMainPlayer(null);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(container.querySelector('audio')).toBeNull();
  });

  it('only offer to be heard when there’s something to hear', () => {
    show(value());
    expect(screen.getAllByRole('button', { name: 'Hear it' })).toHaveLength(1);
  });

  it('show a bridge’s transitions between each song', () => {
    const three = [
      { from: 'Song 2', to: 'Bridge', key: 'a', status: 'ready' },
      { from: 'Bridge', to: 'Wanted', key: 'b', status: 'none' },
      { from: 'Wanted', to: 'Song 3', key: 'c', status: 'none' },
    ];
    const state = value(three);
    state.requests![0].route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    show(state);
    const names = screen.getAllByRole('listitem').slice(1).map((item) => (item.classList.contains('coming-seam') ? 'seam' : 'song'));
    expect(names).toEqual(['seam', 'song', 'seam', 'song', 'seam']);
  });

  it('are fine with a request going at the very end, with no way back to the mix', () => {
    show(value([seams[0]]));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/once this transition is ready/)).toBeInTheDocument();
  });
});

describe('a bridge joining as one', () => {
  const route = [{ id: 8, title: 'Bridge', artist: 'Someone' }, { id: 9, title: 'Wanted', artist: 'Artist' }];
  const three = [
    { from: 'Song 2', to: 'Bridge', key: 'a', status: 'ready', label: 'Blend' },
    { from: 'Bridge', to: 'Wanted', key: 'b', status: 'rendering', label: 'Blend' },
    { from: 'Wanted', to: 'Song 3', key: 'c', status: 'queued', label: 'Blend' },
  ];
  const value = (more: Record<string, unknown> = {}) => ({
    requests: [row({ stage: 'preparing', after_id: 2, route, transitions: three, seconds: 120, ...more })],
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
    findBridges: vi.fn(),
    pickBridge: vi.fn(),
  }) as unknown as RequestsState;
  const show = (state: RequestsState) => render(
    <RequestsContext.Provider value={state}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
  );

  it('says they all come together, and that none of it can play until then', () => {
    show(value());
    expect(screen.getByText('Wanted is on its way, with a bridge')).toBeInTheDocument();
    expect(screen.getByText('These 2 songs join together once all 3 transitions are ready. None of them can play before that.')).toBeInTheDocument();
  });

  it('counts down how much of it is ready', () => {
    show(value());
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 ready · about 2 minutes');
  });

  it('has one way to cancel the lot, and nothing that plays', () => {
    show(value());
    expect(screen.getAllByRole('button', { name: /Cancel request/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Play/ })).toBeNull();
    expect(screen.getAllByText('Not playable yet')).toHaveLength(2);
  });

  it('puts everything in it inside the one block', () => {
    const { container } = show(value());
    expect(container.querySelectorAll('.coming-group')).toHaveLength(1);
    expect(container.querySelectorAll('.coming-group .coming-rows > li')).toHaveLength(5);
  });

  it('does not promise joining before the next valid opening', () => {
    show(value({ stage: 'ready' }));
    expect(screen.getByRole('status')).toHaveTextContent('Ready — waiting for a valid opening');
  });

  it('words a single song differently', () => {
    show(value({ route: undefined, transitions: three.slice(0, 2) }));
    expect(screen.getByText('Wanted is on its way')).toBeInTheDocument();
    expect(screen.getByText('It joins your mix once both transitions are ready. It can’t play before that.')).toBeInTheDocument();
  });
});

describe('rechecking whenever anything changes', () => {
  const considered = (calls: { path: string }[]) => calls.filter((call) => call.path === '/requests/consider').length;
  const backend = () => fakeBackend({
    'GET /requests': { requests: [row()] },
    'POST /requests/consider': { requests: [row({ stage: 'searching' })] },
  });

  it('as soon as the track changes', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    (playback.player.state as { position: number }).position = 1;
    rerender(<Requests playback={{ ...playback }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as the mix is edited', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback, mix: songs(undefined, undefined) }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as a transition is changed, even with the same songs', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback, mix: songs(seam('none', 'x'), undefined, undefined) }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as a transition has finished playing', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    (playback.player.state as { inSeam: boolean }).inSeam = true;
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(calls.some((call) => call.path === '/requests')).toBe(true));
    expect(considered(calls)).toBe(0);
    (playback.player.state as { inSeam: boolean }).inSeam = false;
    rerender(<Requests playback={{ ...playback }} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
  });

  it('but not when nothing has changed', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback }} />);
    await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
    expect(considered(calls)).toBe(1);
  });

  it('looks again if something changed while it was already looking', async () => {
    let finish: (value: Response) => void = () => {};
    let asked = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (!url.includes('consider')) return Promise.resolve(new Response(JSON.stringify({ requests: [row()] }), { status: 200 }));
      asked += 1;
      return asked === 1
        ? new Promise<Response>((resolve) => { finish = resolve; })
        : Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200 }));
    }));
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(asked).toBe(1));
    (playback.player.state as { position: number }).position = 1;
    rerender(<Requests playback={{ ...playback }} />);
    expect(asked).toBe(1);
    await act(async () => { finish(new Response(JSON.stringify({ requests: [row()] }), { status: 200 })); });
    await waitFor(() => expect(asked).toBe(2));
  });

  it('straight after someone presses something', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row({ stage: 'approve' })] },
      'POST /requests/consider': { requests: [row({ stage: 'approve', route: [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }] })] },
      'POST /requests/7/bridge': { requests: [row()] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both' }));
    await waitFor(() => expect(considered(calls)).toBeGreaterThanOrEqual(2));
  });

  it('says so when a request was settled by the song going in by hand', async () => {
    const notify = vi.fn();
    fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [], settled: ['Wanted'] },
    });
    render(<Requests playback={playing(songs(undefined, undefined))} notify={notify} />);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Wanted is in your mix now, so that request is done.'));
  });
});

describe('finding a bridge for a request', () => {
  const option = (more: Record<string, unknown> = {}) => ({
    best: true,
    songs: [{ id: 8, title: 'Bridge', artist: 'Someone', bridge: true }, { id: 9, title: 'Wanted', artist: 'Artist', bridge: false }],
    song_ids: [8, 9],
    after_id: 2,
    after: 'Song 2',
    before: 'Song 3',
    words: 'Tempo barely moves, keys match. 120 → 121 → 120 BPM.',
    transitions: [{ from: 'Song 2', to: 'Bridge', key: 'a', status: 'none', label: 'Blend' }],
    ...more,
  });
  const open = async (answer: unknown, stage: Record<string, unknown> = { stage: 'searching' }) => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row(stage)] },
      'POST /requests/consider': { requests: [row(stage)] },
      'POST /requests/7/bridges': answer,
      'POST /requests/7/bridge': { requests: [row({ picked: [8, 9] })] },
      'POST /requests/7/hear': { seams: [] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Find a bridge' }));
    return calls;
  };

  it('says it’s looking from the moment it’s pressed', async () => {
    await open({ options: [], looked_at: 5, direct: false });
    expect(screen.getByText(/Going through every song in your library/)).toBeInTheDocument();
    expect(await screen.findByText(/Checked 5 songs/)).toBeInTheDocument();
  });

  it('shows the best first, how it gets there, and why', async () => {
    await open({ options: [option(), option({ best: false, song_ids: [7, 9], songs: [{ id: 7, title: 'Other', bridge: true }, { id: 9, title: 'Wanted', bridge: false }] })], looked_at: 581, direct: false });
    const list = await screen.findByRole('list', { name: 'Bridges to Wanted' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Best match');
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Song 2 → Bridge → Wanted → Song 3');
    expect(within(list).getAllByRole('listitem')[1]).not.toHaveTextContent('Best match');
    expect(screen.getByText(/Checked 581 songs/)).toBeInTheDocument();
    expect(screen.getAllByText(/Tempo barely moves/)).toHaveLength(2);
  });

  it('changes nothing until one is chosen', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    await screen.findByRole('button', { name: 'Use this' });
    expect(calls.some((call) => call.path === '/requests/7/bridge')).toBe(false);
  });

  it('choosing one saves those exact songs, and closes straight away', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }));
    expect(screen.queryByRole('list', { name: 'Bridges to Wanted' })).toBeNull();
    expect(screen.getByText('Getting ready')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/bridge')?.body).toEqual({ allow: true, songs: [8, 9] }));
  });

  it('can be heard first, only rendering the one that’s asked for', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Hear the transitions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hear Song 2 into Bridge' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/hear')?.body).toEqual({ keys: ['a'] }));
  });

  it('says so when no song can do it', async () => {
    await open({ options: [], looked_at: 581, direct: false });
    expect(await screen.findByText(/No song makes a clean way there/)).toBeInTheDocument();
  });

  it('says why when the song’s beat is the problem', async () => {
    await open({ options: [], looked_at: 581, direct: false, unsteady: true });
    expect(await screen.findByText(/can’t find a steady enough beat/)).toBeInTheDocument();
  });

  it('says when it takes more than one song', async () => {
    await open({
      options: [option({
        song_ids: [6, 8, 9],
        songs: [{ id: 6, title: 'First', bridge: true }, { id: 8, title: 'Bridge', bridge: true }, { id: 9, title: 'Wanted', bridge: false }],
      })],
      looked_at: 5,
      direct: false,
    });
    expect(await screen.findByText('two extra songs on the way')).toBeInTheDocument();
    expect(screen.getByText('First and Bridge')).toBeInTheDocument();
  });

  it('says so when a bridge isn’t needed', async () => {
    await open({ options: [option()], looked_at: 5, direct: true }, { stage: 'preparing', after: 'Song 2', after_id: 2 });
    expect(await screen.findByText(/It can already go in without a bridge/)).toBeInTheDocument();
  });

  it('says what went wrong if the search fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/bridges')) return new Response(JSON.stringify({ detail: 'Start a mix first.' }), { status: 409 });
      return new Response(JSON.stringify({ requests: [row({ stage: 'searching' })] }), { status: 200 });
    }));
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Find a bridge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Start a mix first.');
  });

  it('is there on every request it could help', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ id: 1, stage: 'searching' }), row({ id: 2, song_id: 10, stage: 'preparing' }), row({ id: 3, song_id: 11, stage: 'approve' })] },
      'POST /requests/consider': { requests: [row({ id: 1, stage: 'searching' }), row({ id: 2, song_id: 10, stage: 'preparing' }), row({ id: 3, song_id: 11, stage: 'approve' })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Find a bridge' })).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'See other bridges' })).toBeInTheDocument();
  });

  it('isn’t offered where it can’t work', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ waiting_on: 'analysis' }), row({ id: 8, song_id: 10, no_cues: true }), row({ id: 3, song_id: 11, never: true })] },
      'POST /requests/consider': { requests: [row({ waiting_on: 'analysis' }), row({ id: 8, song_id: 10, no_cues: true }), row({ id: 3, song_id: 11, never: true })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    await screen.findByText('Getting ready');
    expect(screen.queryByRole('button', { name: 'Find a bridge' })).toBeNull();
  });

  it('offers a different one when it already has one', async () => {
    const route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    fakeBackend({
      'GET /requests': { requests: [row({ stage: 'preparing', route })] },
      'POST /requests/consider': { requests: [row({ stage: 'preparing', route })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    expect(await screen.findByRole('button', { name: 'Find a different bridge' })).toBeInTheDocument();
  });

  it('a song on its way as a bridge can’t be requested as well', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ picked: [8, 9] })] },
      'GET /songs': [found(8, 'Bridge')],
    });
    render(<Requests />);
    await screen.findByText('Wanted');
    fireEvent.change(search(), { target: { value: 'bridge' } });
    expect(await screen.findByRole('button', { name: /Bridge .*Coming as a bridge/ })).toBeDisabled();
  });
});

describe('words for what a request is waiting on', () => {
  it('names the request it’s waiting behind', () => {
    const words = requestWords(row({ behind: 'Other Song' }) as never, 'searching');
    expect(words.detail).toBe('It would go in the same spot as Other Song, so it’s waiting for that to join first. Then it finds its own.');
  });

  it('says when a chosen bridge stopped working', () => {
    expect(requestWords(row({ bridge_lost: true }) as never, 'searching').detail).toMatch(/stopped fitting/);
    expect(requestWords(row({ bridge_lost: true, route: [{ id: 8, title: 'New' }, { id: 9, title: 'Wanted' }] }) as never, 'approve').detail)
      .toBe('The bridge you chose stopped fitting. Getting to it takes one extra song: New.');
  });

  it('counts two extra songs', () => {
    const route = [{ id: 7, title: 'One' }, { id: 8, title: 'Two' }, { id: 9, title: 'Wanted' }];
    expect(requestWords(row({ route }) as never, 'approve').detail).toBe('Getting to it takes two extra songs: One and Two.');
  });

  it('counts three as well', () => {
    const route = [{ id: 6, title: 'A' }, { id: 7, title: 'B' }, { id: 9, title: 'Wanted' }, { id: 8, title: 'C' }];
    expect(requestWords(row({ route }) as never, 'approve').detail).toBe('Getting to it takes three extra songs: A and B and C.');
  });

  it('tells a bridge leading out from one leading in', () => {
    const route = [{ id: 9, title: 'Wanted' }, { id: 8, title: 'After' }];
    expect(requestWords(row({ route, after: 'Song 2' }) as never, 'preparing').detail).toMatch(/^Joins after Song 2, with After leading out\./);
  });

  it('says a bridge won’t play before it’s all ready', () => {
    const route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    expect(requestWords(row({ route, after: 'Song 2' }) as never, 'preparing').detail).toMatch(/none of them can play before that/);
  });
});
