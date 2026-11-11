/* LX-0340 to LX-0352: Library experience contracts that need no browser. Each describe names the
 * checklist items it proves. The browser-level twins live in web/e2e/lx-library.e2e.ts. */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, Reply, songs, status } from '../test/backend';
import { Library } from './Library';
import { nextStep } from './SongDetails';

type Row = ReturnType<typeof row>;
const row = (id: number, title: string, more: Record<string, unknown> = {}) => ({
  id,
  artist: 'Someone',
  title,
  genre: null,
  duration: 200,
  bpm: null as number | null,
  camelot: null as string | null,
  lyric_status: null,
  never: false,
  priority: false,
  detected_bpm: null as number | null,
  detected_camelot: null as string | null,
  override_bpm: null as number | null,
  override_camelot: null as string | null,
  music_override: null,
  energy: null,
  grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
  ...more,
});
const page = (...list: Row[]) => ({ songs: list, total: list.length, next: null });

beforeEach(() => window.history.pushState({}, '', '/library'));
afterEach(() => setPrefs({ libraryLayout: 'list', density: 'comfortable' }));

function show({ state = status(), playing = false, notify = vi.fn(), player = new SetPlayer(() => [], () => {}) } = {}) {
  render(
    <Library
      status={state}
      mix={playing ? songs() : []}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={playing ? { ...player.state, phase: 'playing' } : player.state}
      setView={() => {}}
      notify={notify}
      stage={false}
      toggleStage={() => {}}
    />,
  );
  return { notify, player };
}

const openMenu = async (name: string) => {
  const trigger = screen.queryByRole('button', { name: `More actions for ${name}` });
  if (!trigger) return null;
  await userEvent.click(trigger);
  return screen.getByRole('menu');
};

describe('LX-0346-01, LX-0345-04, LX-0349-07 readiness decides the actions, in both layouts', () => {
  // status, tempo, can start a mix, analyse label (or null), can add by hand
  const contract: [string, number | null, boolean, string | null, boolean][] = [
    ['mix_ready', 120, true, null, true],
    ['analysed_incomplete', 120, false, null, true],
    ['queued', null, false, 'Analyse now', false],
    ['processing', null, false, 'Analyse now', false],
    ['needs_attention', null, false, 'Try analysing again', false],
    ['set_aside', null, false, null, false],
    ['excluded', 120, false, null, false],
    ['missing', 120, false, null, false],
  ];
  for (const layout of ['list', 'cards'] as const) {
    it.each(contract)(`${layout}: %s`, async (state, bpm, start, analyse, add) => {
      setPrefs({ libraryLayout: layout });
      fakeBackend({ 'GET /library': page(row(1, 'Only', { bpm, readiness: { status: state, reason: '' } })) });
      show();
      await screen.findByText('Only');
      expect(!!screen.queryByRole('button', { name: 'Start a mix' })).toBe(start);
      if (analyse) expect(screen.getByRole('button', { name: analyse })).toBeEnabled();
      else expect(screen.queryByRole('button', { name: /Analys/ })).toBeNull();
      const menu = await openMenu('Only');
      expect(!!(menu && within(menu).queryByRole('menuitem', { name: 'Add to current mix' }))).toBe(add);
    });
  }
});

describe('LX-0346-05 analyse buttons tell the truth about the job', () => {
  it('requested, queued, running and failed each read differently', async () => {
    let answer: (value: Response) => void = () => {};
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/analyse')) return new Promise<Response>((resolve) => { answer = resolve; });
      return Promise.resolve(new Response(JSON.stringify(page(
        row(1, 'Asked'),
        row(2, 'Queued'),
        row(3, 'Running'),
        row(4, 'Broke', { readiness: { status: 'needs_attention', reason: 'Selecta couldn’t analyse this file.' } }),
      )), { status: 200 }));
    }));
    const { notify } = show({ state: status({ analysing: [3, 9, 2] }) });
    await screen.findByText('Asked');
    expect(screen.getByRole('button', { name: 'Analysing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Waiting, 2 ahead' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try analysing again' })).toBeEnabled();
    const ask = screen.getByRole('button', { name: 'Analyse now' });
    await userEvent.click(ask);
    // requested, not yet answered: busy, and nothing claims it worked
    expect(ask).toHaveAttribute('aria-busy', 'true');
    expect(within(ask).getByText('Asking…')).toBeInTheDocument();
    await userEvent.click(ask);
    expect(calls.filter((call) => call.includes('/songs/1/analyse'))).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    answer(new Response(JSON.stringify({ ahead: 3 }), { status: 200 }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Asked is in line, with 3 ahead of it.'));
  });
});

describe('LX-0346-07 a repeated press commits once and claims nothing early', () => {
  it('a batch confirmation pressed twice sends one request and reports only after the answer', async () => {
    let answer: (value: Response) => void = () => {};
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/library/batch')) return new Promise<Response>((resolve) => { answer = resolve; });
      return Promise.resolve(new Response(JSON.stringify(page(row(1, 'First'))), { status: 200 }));
    }));
    const { notify } = show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Prioritize selected' }));
    const confirm = screen.getByRole('button', { name: /Confirm 1 recordings/ });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(calls.filter((call) => call.includes('/library/batch'))).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    answer(new Response(JSON.stringify({ updated: 1 }), { status: 200 }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      'Updated 1 precisely selected recordings.',
      expect.any(Function),
    ));
  });
});

describe('LX-0346-04 Add and Play next say what they do to the current mix', () => {
  const ready = row(1, 'First', { bpm: 120, readiness: { status: 'mix_ready', reason: '' } });
  it('with nothing playing only Add is offered, and it starts nothing', async () => {
    const calls = fakeBackend({ 'GET /library': page(ready), 'POST /mix/songs': { mix: songs(), name: 'Mix', can_undo: true } });
    const player = new SetPlayer(() => [], () => {});
    const play = vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
    show({ player });
    await screen.findByText('First');
    const menu = (await openMenu('First'))!;
    expect(within(menu).queryByRole('menuitem', { name: 'Play next in current mix' })).toBeNull();
    const addItem = within(menu).getByRole('menuitem', { name: 'Add to current mix' });
    expect(addItem).toHaveAttribute('title', 'Puts it at the end of the current mix. Nothing starts playing.');
    await userEvent.click(addItem);
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/mix/songs')).toBe(true));
    expect(calls.find((call) => call.path === '/mix/songs')?.body).toEqual({ song_id: 1 });
    expect(play).not.toHaveBeenCalled();
  });
  it('while a mix plays, Play next names its place and keeps what is playing', async () => {
    fakeBackend({ 'GET /library': page({ ...ready, id: 9 }) });
    show({ playing: true });
    await screen.findByText('First');
    const menu = (await openMenu('First'))!;
    expect(within(menu).getByRole('menuitem', { name: 'Play next in current mix' }))
      .toHaveAttribute('title', 'Puts it straight after the song playing now. What\'s playing carries on.');
  });
});

describe('LX-0341-02 counts come from the server, and unknown stays unknown', () => {
  it('a count the server did not give reads "not known yet", never zero or NaN', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show({ state: status({ counts: { total: 12, music: 12 } as never }) });
    await screen.findByText('First');
    const summary = document.querySelector('.library-summary')!;
    expect(summary).toHaveTextContent('Ready for mixes: not known yet');
    expect(summary).toHaveTextContent('Analysed: not known yet');
    expect(summary).toHaveTextContent('12 songs');
    expect(summary.textContent).not.toMatch(/NaN|\b0 ready/);
  });
});

describe('LX-0341-07 an attention count opens exactly what it counts', () => {
  it('the set-aside count opens the Set aside filter, and Back undoes it', async () => {
    const calls = fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('button', { name: '10 set aside' }));
    expect(window.location.search).toBe('?show=set_aside');
    expect(screen.getByRole('button', { name: 'Set aside' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(calls.some((call) => call.path.includes('state=set_aside'))).toBe(true));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

describe('LX-0342-05 a slow old answer never replaces the newest search or takes focus', () => {
  it('focus stays in the search box while answers arrive out of order', async () => {
    const answers: { url: string; resolve: (value: Response) => void }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((resolve) => { answers.push({ url, resolve }); })));
    show();
    await waitFor(() => expect(answers.length).toBe(1));
    answers[0].resolve(new Response(JSON.stringify(page(row(1, 'Start'))), { status: 200 }));
    const box = await screen.findByRole('searchbox', { name: 'Search your library' });
    await userEvent.type(box, 'ab');
    await waitFor(() => expect(answers.some((answer) => answer.url.includes('q=ab'))).toBe(true));
    await userEvent.type(box, 'c');
    await waitFor(() => expect(answers.some((answer) => answer.url.includes('q=abc'))).toBe(true));
    const newest = answers.find((answer) => answer.url.includes('q=abc'))!;
    const older = answers.find((answer) => answer.url.includes('q=ab&'))!;
    newest.resolve(new Response(JSON.stringify(page(row(3, 'Newest'))), { status: 200 }));
    await screen.findByText('Newest');
    older.resolve(new Response(JSON.stringify(page(row(2, 'Older'))), { status: 200 }));
    await new Promise((done) => setTimeout(done, 30));
    expect(screen.queryByText('Older')).toBeNull();
    expect(box).toHaveFocus();
    expect(box).toHaveValue('abc');
  });
});

describe('LX-0347-02, LX-0347-03 selection says exactly what it covers', () => {
  it('0, 1 and 200 selected: the rail appears only for a real selection and names loaded, not all results', async () => {
    const many = Array.from({ length: 201 }, (_, index) => row(index + 1, `Song ${index + 1}`));
    fakeBackend({ 'GET /library': { songs: many, total: 20000, next: 'after-201' } });
    show();
    await screen.findByText('Song 201');
    // 0: one compact entry, no action forest
    expect(screen.queryByRole('button', { name: 'Prioritize selected' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Never play selected' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeVisible();
    // 1
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording Song 7 by/ }));
    expect(screen.getByText(/^1 of 201 loaded recordings selected \(limit 200\)/)).toBeInTheDocument();
    for (const name of ['Clear selection', 'Prioritize selected', 'Remove priority', 'Never play selected', 'Allow selected']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    // 200
    await userEvent.click(screen.getByRole('button', { name: 'Select up to 200 loaded songs' }));
    expect(screen.getByText(/^200 of 201 loaded recordings selected \(limit 200\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/20,?000 (recordings|songs) selected|all (search )?results selected/i);
   }, 60_000);
});

describe('LX-0347-05 a new search, filter or sort clears the old selection', () => {
  it('typing a search drops the selection instead of carrying it over', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First'), row(2, 'Second')) });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    expect(screen.getByRole('button', { name: 'Prioritize selected' })).toBeVisible();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your library' }), 'r');
    await waitFor(() => expect(window.location.search).toBe('?q=r'));
    await screen.findByText('First');
    expect(screen.queryByRole('button', { name: 'Prioritize selected' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Select recording First/ })).not.toBeChecked();
  });
});

describe('LX-0347-06, LX-0347-07 refused batches change nothing and focus has somewhere to go', () => {
  it('a 409 from the server keeps the selection, claims nothing and says why', async () => {
    const calls = fakeBackend({
      'GET /library': page(row(1, 'First', { priority: false })),
      'POST /library/batch': new Reply(409, { detail: 'A song changed since selection. Refresh and try again.' }),
    });
    const { notify } = show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Prioritize selected' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm 1 recordings/ }));
    await waitFor(() => expect(calls.some((call) => call.path === '/library/batch')).toBe(true));
    await new Promise((done) => setTimeout(done, 20));
    expect(notify).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Select recording First/ })).toBeChecked();
  });
  it('cancelling the confirmation returns focus to the action that opened it', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: /Select recording First/ }));
    const opener = screen.getByRole('button', { name: 'Never play selected' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel - change nothing' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('LX-0348-03, LX-0348-04 the song sheet separates measured, corrected and unknown, and gives a next step', () => {
  it('a correction, the measurement and an unknown are labelled apart', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'Fixed', {
      bpm: 124, detected_bpm: 120, override_bpm: 124, camelot: null, detected_camelot: null,
      readiness: { status: 'analysed_incomplete', reason: 'Still looking up its lyrics.' },
    })) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for Fixed' }));
    const sheet = screen.getByRole('dialog', { name: 'Fixed' });
    const fact = (term: string) => within(sheet).getByText(term, { selector: 'dt' }).nextElementSibling;
    expect(fact('Tempo in use')).toHaveTextContent('124 BPM (your correction)');
    expect(fact('Tempo measured')).toHaveTextContent('120 BPM');
    expect(fact('Key in use')).toHaveTextContent('Not measured yet');
    expect(fact('Key measured')).toHaveTextContent('Not measured yet');
    expect(within(sheet).getByText('It can still be added to a mix by hand.')).toBeInTheDocument();
  });
  it.each(['needs_attention', 'missing', 'queued', 'processing', 'excluded', 'set_aside'])('%s has a truthful next step', (state) => {
    expect(nextStep(state)).not.toBe('');
    expect(nextStep(state)).not.toMatch(/ready|playable|will be fixed/i);
  });
  it('a missing file says where to look, and offers nothing that would play it', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'Gone', { bpm: 120, readiness: { status: 'missing', reason: 'The file isn’t where it was.' } })) });
    show();
    await screen.findByText('Gone');
    expect(screen.queryByRole('button', { name: 'Start a mix' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Details for Gone' }));
    expect(screen.getByText(/Put the file back where it was/)).toBeInTheDocument();
  });
});

describe('LX-0349-06 a failed save keeps what was typed and points at the problem', () => {
  const failures: [string, () => Promise<Response>][] = [
    ['server error', async () => new Response(JSON.stringify({ detail: 'Selecta had a problem saving that.' }), { status: 500 })],
    ['conflict', async () => new Response(JSON.stringify({ detail: 'That song changed. Refresh and try again.' }), { status: 409 })],
    ['validation', async () => new Response(JSON.stringify({ detail: 'Tempo has to be between 40 and 240.' }), { status: 400 })],
    ['network', async () => { throw new TypeError('Failed to fetch'); }],
  ];
  it.each(failures)('%s', async (_name, fail) => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.includes('/correct')
      ? fail()
      : Promise.resolve(new Response(JSON.stringify(page(row(1, 'Song', { bpm: 120, detected_bpm: 120 }))), { status: 200 })))));
    const { notify } = show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for Song' }));
    const tempo = screen.getByRole('spinbutton', { name: /Tempo/ });
    await userEvent.type(tempo, '128');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert.textContent).not.toBe('');
    expect(tempo).toHaveValue(128);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('LX-0340-07, LX-0352-03 first run, nothing ready and no match each say something different', () => {
  it('a partly scanned library offers no playable action and explains readiness', async () => {
    window.history.pushState({}, '', '/library?show=ready');
    fakeBackend({ 'GET /library': page() });
    show({ state: status({ counts: { total: 5, music: 5, set_aside: 0, analysed: 0, ready: 0, lyrics: 0 } }) });
    expect(await screen.findByRole('heading', { name: 'No songs are ready for mixes yet' })).toBeInTheDocument();
    expect(screen.getByText(/becomes ready for mixes once Selecta has analysed it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all songs' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start a mix' })).toBeNull();
    expect(screen.getByText('Looking in: Ready.')).toBeInTheDocument();
  });
  it('queued songs on first run cannot start a mix', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'One'), row(2, 'Two')) });
    show({ state: status({ counts: { total: 2, music: 2, set_aside: 0, analysed: 0, ready: 0, lyrics: 0 } }) });
    await screen.findByText('One');
    expect(screen.queryByRole('button', { name: 'Start a mix' })).toBeNull();
    expect(screen.getAllByText('Waiting to be analysed')).toHaveLength(2);
    expect(document.querySelector('.library-summary')).toHaveTextContent('0 ready for mixes');
  });
  it('an empty library, an empty filter and a search with no match have different next actions', async () => {
    fakeBackend({ 'GET /library': page() });
    const empty = status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, ready: 0, lyrics: 0 } });
    show({ state: empty });
    expect(await screen.findByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add music' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    act(() => {
      window.history.pushState({}, '', '/library?q=zzz&show=attention');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'Nothing matches “zzz”.' })).toBeInTheDocument();
    expect(screen.getByText('Looking in: Needs attention, searching for “zzz”.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add music' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    // clearing the search keeps the filter that was chosen
    await waitFor(() => expect(window.location.search).toBe('?show=attention'));
  });
});

describe('LX-0344-03 unknown key and tempo say so in words', () => {
  it('an unmeasured key is named, not a bare dash', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'Tempo only', { bpm: 120 }), row(2, 'Nothing yet')) });
    show();
    await screen.findByText('Tempo only');
    const facts = [...document.querySelectorAll('.song-columns')].map((node) => node.textContent);
    expect(facts[0]).toContain('120 BPM');
    expect(facts[0]).toContain('Key unknown');
    expect(facts[1]).toContain('Not analysed');
    expect(facts[1]).toContain('No key yet');
  });
});

describe('LX-0345-07, LX-0350-06, LX-0350-07 a 20,000 song library renders one page, as a real list', () => {
  it('card view asks for one page and renders exactly that page, all of it in the DOM', async () => {
    setPrefs({ libraryLayout: 'cards' });
    const many = Array.from({ length: 100 }, (_, index) => row(index + 1, `Song ${index + 1}`));
    const calls = fakeBackend({ 'GET /library': { songs: many, total: 20000, next: '["Song 100",100]' } });
    show();
    await screen.findByText('Song 100');
    expect(document.querySelector('ul.library-rows')).toHaveClass('library-cards');
    expect(document.querySelectorAll('ul.library-rows > li')).toHaveLength(100);
    expect(calls.filter((call) => call.path.startsWith('/library?'))).toHaveLength(1);
    expect(screen.getByText('Showing 100 of 20000 songs.')).toBeInTheDocument();
    // not virtualised: every loaded row is in reading order, so find-in-page and AT see them all
    const titles = [...document.querySelectorAll('ul.library-rows > li .song-open b')].map((node) => node.textContent);
    expect(titles).toEqual(many.map((song) => song.title));
  });
});

describe('LX-0352-02 the loading placeholder takes the shape of the chosen layout', () => {
  it.each([['list', 'skeleton-library'], ['cards', 'skeleton-cards']] as const)('%s', async (layout, shape) => {
    setPrefs({ libraryLayout: layout });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    show();
    const skeleton = await screen.findByRole('status', { name: 'Loading your songs' });
    expect(skeleton).toHaveClass(shape);
    // a placeholder never pretends to be a song
    expect(skeleton.textContent).toBe('Loading your songs');
  });
});

describe('LX-0343-04, LX-0342-08 nothing unapproved is offered', () => {
  it('only the supported filters and a plain search box are shown', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'First')) });
    show();
    await screen.findByText('First');
    const group = screen.getByRole('group', { name: 'Filter Library recordings' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Everything', 'Ready', 'Not analysed yet', 'Needs attention', 'Priority list', 'Set aside']);
    expect(screen.queryByRole('spinbutton')).toBeNull();
    const box = screen.getByRole('searchbox', { name: 'Search your library' });
    expect(box).not.toHaveAttribute('aria-autocomplete');
    expect(box).not.toHaveAttribute('list');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('LX-0340-05 a title shared by different artists never gives two recordings the same button name', () => {
  it('names the artist when only the title is shared, and the ID when title and artist are', async () => {
    fakeBackend({ 'GET /library': page(
      row(1, 'Same', { artist: 'Ann' }), row(2, 'Same', { artist: 'Bo' }),
      row(3, 'Twin', { artist: 'Cy' }), row(4, 'Twin', { artist: 'Cy' }), row(5, 'Alone'),
    ) });
    show();
    await screen.findByText('Alone');
    const names = [...document.querySelectorAll('.song-open')].map((node) => node.getAttribute('aria-label'));
    expect(names).toEqual(['Details for Same by Ann', 'Details for Same by Bo', 'Details for Twin (song 3)', 'Details for Twin (song 4)', 'Details for Alone']);
    expect(new Set(names).size).toBe(names.length);
    expect(screen.getByRole('button', { name: 'More actions for Same by Bo' })).toBeInTheDocument();
  });
});
