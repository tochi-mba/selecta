import { ApiError } from '../api';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, songs, status } from '../test/backend';
import { Library } from './Library';

const row = (id: number, title: string) => ({
  id,
  artist: 'Someone',
  title,
  genre: null,
  duration: 200,
  bpm: null,
  camelot: null,
  lyric_status: null,
  never: false,
  priority: false,
  detected_bpm: null,
  detected_camelot: null,
  override_bpm: null,
  override_camelot: null,
  music_override: null,
  energy: null,
  grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});
const page = (...songs: (Omit<ReturnType<typeof row>, 'bpm'> & { bpm: number | null })[]) => ({ songs, total: songs.length, next: null });

beforeEach(() => window.history.pushState({}, '', '/library'));

function show(state = status(), refreshStatus = () => {}, notify: (m: string) => void = () => {}) {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library
      status={state}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={refreshStatus}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={notify}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

describe('songs not analysed yet', () => {
  it('shows each song’s place in one line, so clicks can’t pile up', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First'), row(2, 'Second'), row(3, 'Third')) });
    show(status({ analysing: [1, 2] }));
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(await screen.findByRole('button', { name: 'Analysing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Waiting, 1 ahead' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Analyse now' })).toBeEnabled();
  });

  it('offers the whole lot in one press', async () => {
    const calls = fakeBackend({ 'GET /library': page(row(1, 'First')), 'POST /analysis/start': { running: true } });
    const refreshStatus = vi.fn();
    show(status(), refreshStatus);
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(screen.getByText(/40 songs left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyse them all' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/analysis/start')).toBe(true));
    expect(refreshStatus).toHaveBeenCalled();
  });

  it('doesn’t offer it twice', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show(status({ analysis_running: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(screen.queryByRole('button', { name: 'Analyse them all' })).toBeNull();
    expect(screen.getByRole('button', { name: /Analysing now/ })).toBeInTheDocument();
  });

  it('lets the listener prioritize a song and shows the priority list', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'First')),
      'POST /songs/1/priority': { song_id: 1, priority: 100 },
    });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('button', { name: 'More actions for First' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Prioritize' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/songs/1/priority?priority=100')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Priority list' }));
    await waitFor(() => expect(calls.some((call) => call.path.includes('state=priority'))).toBe(true));
  });
});

describe('starting a mix from a song', () => {
  const ready = { ...row(1, 'First'), bpm: 120, readiness: { status: 'mix_ready', reason: '' } };
  const backend = (build: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn((url: string) => (
    url.includes('/vibes/pick/build') ? build() : Promise.resolve(new Response(JSON.stringify(page(ready, { ...ready, id: 2, title: 'Second' })), { status: 200 }))
  )));

  it('says it’s building straight away, and only one can be built at a time', async () => {
    let finish: (value: Response) => void = () => {};
    const build = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    backend(build);
    show();
    const buttons = await screen.findAllByRole('button', { name: 'Start a mix' });
    await userEvent.click(buttons[0]);
    expect(screen.getByRole('button', { name: 'Building your mix…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Start a mix' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Building your mix…' }));
    expect(build).toHaveBeenCalledOnce();
    finish(new Response(JSON.stringify({ mix: [], name: 'Mix', can_undo: false }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Building your mix…' })).toBeNull());
  });

  it('cancels active playback replacement without building, and guards the confirmed build', async () => {
    const ready = { ...row(1, 'First'), bpm: 120, readiness: { status: 'mix_ready', reason: '' } };
    const calls = fakeBackend({
      'GET /library': page(ready),
      'POST /vibes/pick/build': { mix: songs(), name: 'From First', can_undo: true },
    });
    const player = new SetPlayer(() => [], () => {});
    const play = vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
    const setMixData = vi.fn();
    render(
      <Library
        status={status()}
        mix={songs()}
        mixName="Current"
        canUndo={false}
        refreshMix={() => {}}
        setMixData={setMixData}
        refreshStatus={() => {}}
        player={player}
        now={{ ...player.state, phase: 'playing' }}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start a mix' }));
    expect(screen.getByRole('dialog', { name: 'Replace your current mix?' })).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('/vibes/pick/build'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Keep current mix' }));
    expect(setMixData).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Start a mix' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace and play' }));
    await waitFor(() => expect(setMixData).toHaveBeenCalledOnce());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/vibes/pick/build?start=1', expect.objectContaining({
      headers: expect.objectContaining({
        'x-mix-order': '1',
        'x-operation-id': expect.stringMatching(/^build-/),
      }),
    }));
    expect(play).toHaveBeenCalledWith(0);
  });

  it('says why if it couldn’t, and can be tried again', async () => {
    const notify = vi.fn();
    backend(async () => new Response(JSON.stringify({ detail: 'Nothing goes with that.' }), { status: 400 }));
    show(status(), () => {}, notify);
    const buttons = await screen.findAllByRole('button', { name: 'Start a mix' });
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Nothing goes with that.'));
    expect(screen.getAllByRole('button', { name: 'Start a mix' })[0]).toBeEnabled();
  });
});

describe('a big library', () => {
  const many = (from: number, count: number) => Array.from({ length: count }, (_, index) => row(from + index, `Song ${from + index}`));

  it('shows how many there are, and fetches more without losing its place', async () => {
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => (url.includes('after=')
        ? { songs: many(101, 2), total: 102, next: null }
        : { songs: many(1, 100), total: 102, next: '["song 100",100]' }),
    });
    show();
    expect(await screen.findByText('Showing 100 of 102 songs.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more songs' }));
    expect(await screen.findByText('102 songs.')).toBeInTheDocument();
    expect(screen.getByText('Song 1')).toBeInTheDocument();
    expect(screen.getByText('Song 102')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more songs' })).toBeNull();
    expect(calls.some((call) => call.path.includes('after=%5B%22song'))).toBe(true);
  });

  it('restores the requested page depth when navigation changes only the URL', async () => {
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => (url.includes('after=')
        ? { songs: [row(3, 'Third')], total: 3, next: null }
        : { songs: [row(1, 'First'), row(2, 'Second')], total: 3, next: 'cursor-next' }),
    });
    show();
    expect(await screen.findByText('Showing 2 of 3 songs.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more songs' }));
    expect(await screen.findByText('3 songs.')).toBeInTheDocument();
    expect(window.location.search).toContain('pages=2');
    expect(calls.filter((call) => call.path.includes('after=')).length).toBe(1);
    // A saved address or browser-history entry can change the page count while
    // leaving q/show/sort exactly as they were.
    act(() => {
      window.history.replaceState({}, '', '/library');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByText('Showing 2 of 3 songs.')).toBeInTheDocument();
    expect(screen.queryByText('Third')).toBeNull();
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('reloads an edited song on a middle page, not just the first or last page', async () => {
    window.history.pushState({}, '', '/library?pages=4');
    const many = (first: number) => Array.from({ length: 100 }, (_, index) => row(first + index, `Song ${first + index}`));
    let prioritized = false;
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => {
        const after = new URLSearchParams(url.split('?')[1]).get('after');
        if (after === 'c2') return { songs: many(101), total: 400, next: 'c3' };
        if (after === 'c3') {
          const batch = many(201);
          if (prioritized) batch[0] = { ...batch[0], priority: true };
          return { songs: batch, total: 400, next: 'c4' };
        }
        if (after === 'c4') return { songs: many(301), total: 400, next: null };
        return { songs: many(1), total: 400, next: 'c2' };
      },
      'POST /songs/201/priority': () => { prioritized = true; return { saved: true }; },
    });
    show();
    await screen.findByText('Song 400');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Song 201' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Prioritize' }));
    await waitFor(() => expect(calls.filter((call) => call.path.includes('after=c3')).length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Song 201' }));
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Priority: on' })).toBeInTheDocument();
  });

  it('a song that turns up on two pages only shows once', async () => {
    fakeBackend({
      'GET /library': (_body: unknown, url: string) => (url.includes('after=')
        ? { songs: many(2, 2), total: 3, next: null }
        : { songs: many(1, 2), total: 3, next: 'x' }),
    });
    show();
    await screen.findByText('Song 1');
    await userEvent.click(screen.getByRole('button', { name: 'Show more songs' }));
    await screen.findByText('Song 3');
    expect(screen.getAllByText('Song 2')).toHaveLength(1);
  });

  it('keeps what you were looking for in the address', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('button', { name: 'Priority list' }));
    expect(window.location.search).toBe('?show=priority');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'artist');
    expect(window.location.search).toContain('sort=artist');
  });

  it('resolves a linked song by exact ID outside the current filter and page', async () => {
    window.history.pushState({}, '', '/library?show=ready&song=72');
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => (new URLSearchParams(url.split('?')[1]).get('q') === '72'
        ? page(row(72, 'Exact recording'))
        : page(row(2, 'A different recording'))),
    });
    show();
    const details = await screen.findByRole('dialog', { name: 'Exact recording' });
    expect(calls.some((call) => call.path.includes('q=72'))).toBe(true);
    await userEvent.click(within(details).getByText('Advanced'));
    expect(within(details).getByText('72')).toBeInTheDocument();
    act(() => {
      window.history.replaceState({}, '', '/library?show=ready');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Exact recording' })).toBeNull());
  });

  it('never opens another song if a deep-link ID is missing, and can retry', async () => {
    window.history.pushState({}, '', '/library?song=99');
    let recovered = false;
    const calls = fakeBackend({
      'GET /library': (_body: unknown, url: string) => (new URLSearchParams(url.split('?')[1]).get('q') === '99' && recovered
        ? page(row(99, 'Returned recording'))
        : page(row(2, 'Another recording'))),
    });
    show();
    expect(await screen.findByText(/That exact recording is no longer available/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    recovered = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Returned recording' })).toBeInTheDocument();
    expect(calls.filter((call) => call.path.includes('q=99'))).toHaveLength(2);
  });
  it('only the newest search counts, however the answers arrive', async () => {
    const answers: ((value: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answers.push(resolve); })));
    show();
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'Priority list' }));
    await waitFor(() => expect(answers.length).toBeGreaterThan(1));
    answers[answers.length - 1](new Response(JSON.stringify(page(row(2, 'Newest'))), { status: 200 }));
    await screen.findByText('Newest');
    answers[0](new Response(JSON.stringify(page(row(1, 'Stale'))), { status: 200 }));
    await new Promise((done) => setTimeout(done, 20));
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Newest')).toBeInTheDocument();
  });

  it('not being able to load isn’t the same as having no songs', async () => {
    fakeBackend({});
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your songs are fine');
    expect(screen.queryByText(/Nothing here/)).toBeNull();
  });
});

describe('whether a song can go in a mix', () => {
  it.each([
    ['mix_ready', 'Ready for mixes'],
    ['analysed_incomplete', 'Not ready for mixes'],
    ['processing', 'Being analysed'],
    ['needs_attention', 'Couldn’t be analysed'],
    ['missing', 'File is missing'],
  ])('%s says %s', async (state, words) => {
    fakeBackend({ 'GET /library': page({ ...row(1, 'First'), readiness: { status: state, reason: '' } }) });
    show();
    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it('gives the reason in the song’s details', async () => {
    fakeBackend({ 'GET /library': page({ ...row(1, 'First'), readiness: { status: 'analysed_incomplete', reason: 'No timed lyrics.' } }) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for First' }));
    const details = await screen.findByRole('dialog', { name: 'First' });
    expect(within(details).getByText('No timed lyrics.')).toBeInTheDocument();
  });
});

describe('library card presentation', () => {
  it('preserves the same song actions, readiness reason and list while switching layouts', async () => {
    setPrefs({ libraryLayout: 'list', density: 'compact' });
    try {
      fakeBackend({ 'GET /library': page({
        ...row(1, 'First'),
        readiness: { status: 'needs_attention', reason: 'Audio file is missing.' },
      }, { ...row(2, 'Second'), bpm: 120, readiness: { status: 'mix_ready', reason: '' } }) });
      show();
      await screen.findByText('First');
      expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Audio file is missing.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
      expect(document.querySelector('ul.library-rows')).toHaveClass('library-cards');
      expect(screen.getByRole('button', { name: 'Details for First' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start a mix' })).toBeInTheDocument();
      expect(screen.getByText('Audio file is missing.')).toBeVisible();
      expect(JSON.parse(localStorage.getItem('selecta.prefs') ?? '{}').libraryLayout).toBe('cards');
      fireEvent.click(screen.getByRole('button', { name: 'List view' }));
      expect(document.querySelector('ul.library-rows')).not.toHaveClass('library-cards');
      expect(screen.getByRole('button', { name: 'Details for First' })).toBeInTheDocument();
    } finally {
      setPrefs({ libraryLayout: 'list', density: 'comfortable' });
    }
  });
});

describe('correcting a song', () => {
  const measured = { ...row(1, 'First'), bpm: 80, camelot: '8A', detected_bpm: 80, detected_camelot: '8A', readiness: { status: 'mix_ready', reason: '' } };
  const open = async (song: unknown = measured, more: Record<string, unknown> = {}) => {
    const calls = fakeBackend({ 'GET /library': page(song as never), 'POST /songs/1/correct': { redone: 3 }, ...more });
    const notify = vi.fn();
    show(status(), () => {}, notify);
    await userEvent.click(await screen.findByRole('button', { name: 'Details for First' }));
    const sent = () => calls.find((call) => call.path === '/songs/1/correct')?.body;
    return { calls, notify, sent };
  };

  it('double and half fill in what was measured', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Double measured tempo/ }));
    expect(screen.getByRole('spinbutton')).toHaveValue(160);
    await userEvent.click(screen.getByRole('button', { name: /Halve measured tempo/ }));
    expect(screen.getByRole('spinbutton')).toHaveValue(40);
  });

  it('saves what was typed, and says what’ll be made again', async () => {
    const { sent, notify } = await open();
    await userEvent.type(screen.getByRole('spinbutton'), '160');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(sent()).toEqual({ bpm: 160, clear: ['camelot'] }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Saved your correction. 3 transitions with this song will be made again.'));
  });

  it('can go back to what was measured', async () => {
    const { sent } = await open({ ...measured, bpm: 160, override_bpm: 160 });
    expect(screen.getByText(/your correction/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use what was measured' }));
    await waitFor(() => expect(sent()).toEqual({ clear: ['bpm', 'camelot'] }));
  });

  it('shows what’s wrong with a value that isn’t allowed, and keeps it there', async () => {
    const answer = () => { throw new ApiError('Tempo has to be between 40 and 240.', 400); };
    await open(measured, { 'POST /songs/1/correct': answer });
    await userEvent.type(screen.getByRole('spinbutton'), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('between 40 and 240');
    expect(screen.getByRole('spinbutton')).toHaveValue(900);
  });

  it('music and not music can be switched, without touching the file', async () => {
    const { sent } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'This isn’t music' }));
    await waitFor(() => expect(sent()).toEqual({ is_music: false }));
  });
});


describe('contextual selection controls', () => {
  it('shows bulk actions only for a real selection and returns focus to the compact entry when cleared', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First'), row(2, 'Second')) });
    show();
    await screen.findByText('First');
    const entry = screen.getByRole('button', { name: 'Select up to 200 loaded songs' });
    expect(screen.queryByRole('button', { name: 'Prioritize selected' })).toBeNull();
    const checkbox = screen.getByRole('checkbox', { name: /Select recording First/ });
    await userEvent.click(checkbox);
    expect(checkbox.closest('li')).toHaveClass('selected');
    expect(screen.getByRole('button', { name: 'Prioritize selected' })).toBeVisible();
    expect(screen.getByText(/1 of 2 loaded recordings selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('button', { name: 'Prioritize selected' })).toBeNull();
    expect(checkbox).not.toBeChecked();
    expect(entry).toHaveFocus();
  });

  it('selects at most 200 loaded IDs, not the whole filtered library', async () => {
    const many = Array.from({ length: 201 }, (_, index) => row(index + 1, `Song ${index + 1}`));
    fakeBackend({ 'GET /library': { songs: many, total: 20000, next: 'after-201' } });
    show();
    await screen.findByText('Song 201');
    await userEvent.click(screen.getByRole('button', { name: 'Select up to 200 loaded songs' }));
    expect(document.querySelectorAll('.library-batch-check input:checked')).toHaveLength(200);
    expect(screen.getByText(/200 of 201 loaded recordings selected/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select recording Song 201/ })).toBeDisabled();
  });

  it('refuses a confirmed batch action if a different filter takes over while the dialog is open', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'First')),
      'POST /library/batch': { updated: 1 },
    });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Prioritize selected' }));
    expect(screen.getByRole('dialog', { name: 'Apply batch Library action?' })).toBeVisible();
    act(() => {
      window.history.pushState({}, '', '/library?show=ready');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 1 recordings' }));
    expect(calls.filter((call) => call.path === '/library/batch')).toHaveLength(0);
  });
});

describe('Library music-first retrieval', () => {
  it('makes duplicate recording IDs visible in both rows and song details', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'Same title'), row(2, 'Same title')) });
    show();
    expect(await screen.findAllByText('Same title')).toHaveLength(2);
    expect(screen.getByText('Recording 1')).toBeInTheDocument();
    expect(screen.getByText('Recording 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Details for Same title (song 2)' }));
    expect(screen.getByText('Recording ID 2')).toBeInTheDocument();
  });

  it('distinguishes analysed songs from mix-ready songs without promising rendered transitions', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show();
    await screen.findByText('First');
    expect(screen.getByText(/Analysed means audio has been measured/)).toBeInTheDocument();
    expect(screen.getByText(/does not mean transitions are already rendered/)).toBeInTheDocument();
  });

  it('shows exact current flags before confirming a batch edit', async () => {
    const calls = fakeBackend({ 'GET /library': page({ ...row(1, 'First'), priority: true }) });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove priority' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply batch Library action?' });
    expect(within(dialog).getByText(/ID 1; priority on; excluded no/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel - change nothing' }));
    expect(calls.some((call) => call.method === 'POST' && call.path === '/library/batch')).toBe(false);
  });

  it('offers an actual next step for a library without source music', async () => {
    fakeBackend({ 'GET /library': page() });
    show(status({ counts: { ...status().counts, music: 0, analysed: 0, ready: 0 } }));
    expect(await screen.findByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add music' })).toBeEnabled();
  });
});
