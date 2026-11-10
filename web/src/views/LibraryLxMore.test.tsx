/* LX-0341 to LX-0350: more Library experience contracts that need no browser (the first set is in
 * LibraryLx.test.tsx; the browser-level twins live in web/e2e/lx-library.e2e.ts). */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

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
  readiness: { status: 'mix_ready', reason: '' },
  ...more,
});
const page = (...list: Row[]) => ({ songs: list, total: list.length, next: null });

beforeEach(() => window.history.pushState({}, '', '/library'));
afterEach(() => setPrefs({ libraryLayout: 'list', density: 'comfortable' }));

function show({ state = status(), playing = false, notify = vi.fn() } = {}) {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library
      status={state}
      mix={[]}
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
  return { notify };
}

describe('LX-0341-03 ready for mixes is told apart from analysed and from ready transitions', () => {
  it('a misleading pair of numbers (many analysed, none ready) still reads as two different things', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'One')) });
    show({ state: status({ counts: { total: 90, music: 90, set_aside: 0, analysed: 90, ready: 0, lyrics: 0 } }) });
    await screen.findByText('One');
    const summary = document.querySelector('.library-summary') as HTMLElement;
    expect(summary).toHaveTextContent('0 ready for mixes');
    expect(summary).toHaveTextContent('90 analysed');
    const help = document.querySelector('.library-readiness-help') as HTMLElement;
    expect(help).toHaveTextContent('Analysed means audio has been measured');
    expect(help).toHaveTextContent('it does not mean transitions are already rendered');
  });
});

describe('LX-0343-01 the frequent filters have plain names, with priority and set aside still there', () => {
  it('shows the filters in a labelled group, in order', async () => {
    fakeBackend({ 'GET /library': page(row(1, 'One')) });
    show();
    await screen.findByText('One');
    const group = screen.getByRole('group', { name: 'Filter Library recordings' });
    const names = within(group).getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual(['Everything', 'Ready', 'Not analysed yet', 'Needs attention', 'Priority list', 'Set aside']);
    expect(within(group).getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('LX-0342-06, LX-0343-07 no match says what is hiding songs and each way back is a single, reversible step', () => {
  it('Clear search keeps the filter; Show all songs keeps the search and Back undoes it', async () => {
    window.history.pushState({}, '', '/library?show=attention&q=zzz');
    const calls = fakeBackend({ 'GET /library': { songs: [], total: 0, next: null } });
    show();
    expect(await screen.findByRole('heading', { name: 'Nothing matches “zzz”.' })).toBeInTheDocument();
    expect(screen.getByText('Looking in: Needs attention, searching for “zzz”.')).toBeInTheDocument();
    // Show all songs drops only the filter, and is a history step
    await userEvent.click(screen.getByRole('button', { name: 'Show all songs' }));
    await waitFor(() => expect(window.location.search).toBe('?q=zzz'));
    act(() => window.history.back());
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('show')).toBe('attention'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Needs attention' })).toHaveAttribute('aria-pressed', 'true'));
    // Clear search drops only the search
    await userEvent.click(await screen.findByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(window.location.search).toBe('?show=attention'));
    expect(screen.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('');
    await waitFor(() => expect(calls.at(-1)?.path).toContain('state=attention'));
    expect(calls.at(-1)?.path).toContain('q=&');
  });
});

describe('LX-0344-04 one stable primary action per row, the rest in one menu', () => {
  it.each([
    ['mix_ready', 'Start a mix'],
    ['queued', 'Analyse now'],
    ['needs_attention', 'Try analysing again'],
  ])('%s shows %s and More actions only', async (state, primary) => {
    fakeBackend({ 'GET /library': page(row(1, 'Only', { bpm: state === 'mix_ready' ? 120 : null, readiness: { status: state, reason: '' } })) });
    show({ playing: true });
    await screen.findByText('Only');
    const actions = document.querySelector('.song-actions') as HTMLElement;
    // exactly two controls: the one primary action for this state and the menu
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(within(actions).getByRole('button', { name: primary })).toBeInTheDocument();
    await userEvent.click(within(actions).getByRole('button', { name: 'More actions for Only' }));
    const menu = screen.getByRole('menu');
    expect([...within(menu).queryAllByRole('menuitem'), ...within(menu).queryAllByRole('menuitemcheckbox')].length).toBeGreaterThan(0);
  });
});

describe('LX-0348-02, LX-0348-06, LX-0349-01 the song sheet reads facts first, then a predictable correction', () => {
  const corrected = row(1, 'First', { bpm: 160, detected_bpm: 80, override_bpm: 160, camelot: '8A', detected_camelot: '8A' });

  it('facts come before any edit field, and advanced facts are folded away but reachable', async () => {
    fakeBackend({ 'GET /library': page(corrected) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for First' }));
    const sheet = screen.getByRole('dialog', { name: 'First' });
    const facts = sheet.querySelector('dl.song-facts:not(.song-capabilities)') as HTMLElement;
    const firstField = within(sheet).getByRole('spinbutton', { name: /Tempo/ });
    expect(facts.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(facts).getByText('Tempo in use')).toBeInTheDocument();
    const advanced = sheet.querySelector('details.song-advanced') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    await userEvent.click(within(advanced).getByText('Advanced'));
    expect(advanced.open).toBe(true);
    expect(within(advanced).getByText('Song number')).toBeInTheDocument();
  });

  it('the allowed format, the correction in use and what resetting does are all shown before Save', async () => {
    fakeBackend({ 'GET /library': page(corrected) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for First' }));
    const sheet = screen.getByRole('dialog', { name: 'First' });
    expect(within(sheet).getByRole('spinbutton', { name: /Tempo/ })).toHaveAccessibleDescription(/Between 40 and 240 BPM/);
    expect(within(sheet).getByRole('textbox', { name: /Key/ })).toHaveAccessibleDescription(/Like 8A or 11B/);
    expect(within(sheet).getByText(/160 BPM \(your correction\)/)).toBeInTheDocument();
    expect(within(sheet).getByText(/What it measured is kept, so this can be put back/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Use what was measured' })).toBeInTheDocument();
  });
});

describe('LX-0349-03 rework is the server’s number, with no made-up progress or ETA', () => {
  it.each([
    [0, 'Saved your correction.'],
    [1, 'Saved your correction. 1 transition with this song will be made again.'],
    [7, 'Saved your correction. 7 transitions with this song will be made again.'],
  ])('redone %i', async (redone, said) => {
    fakeBackend({
      'GET /library': page(row(1, 'First', { bpm: 80, detected_bpm: 80, camelot: '8A', detected_camelot: '8A' })),
      'POST /songs/1/correct': { redone },
    });
    const { notify } = show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for First' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: /Tempo/ }), '160');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(said));
    expect(String(notify.mock.calls[0][0])).not.toMatch(/%|minute|second|done|complete/i);
  });
});

describe('LX-0350-03 a background refresh asks for what is loaded, never every song', () => {
  it('with three pages loaded, one refresh makes at most two bounded requests', async () => {
    window.history.pushState({}, '', '/library?pages=3');
    const lots = (after: number) => Array.from({ length: 100 }, (_, index) => row(after + index + 1, `Song ${after + index + 1}`));
    const calls = fakeBackend({
      'GET /library': (_body: unknown, path: string) => {
        const after = Number(new URLSearchParams(path.split('?')[1]).get('after') ?? 0);
        return { songs: lots(after), total: 20_000, next: String(after + 100) };
      },
    });
    show();
    await waitFor(() => expect(document.querySelectorAll('.song-row')).toHaveLength(300), { timeout: 20_000 });
    const before = calls.length;
    // the poll's own catch-up path: the same refresh the 4 to 15 second timer runs
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const refresh = calls.slice(before).filter((call) => call.path.startsWith('/library'));
    expect(refresh.length).toBeGreaterThanOrEqual(1);
    expect(refresh.length).toBeLessThanOrEqual(2);
    for (const call of refresh) expect(Number(new URLSearchParams(call.path.split('?')[1]).get('limit'))).toBeLessThanOrEqual(200);
    // the rows already shown stay, merged by ID
    expect(document.querySelectorAll('.song-row')).toHaveLength(300);
  }, 40_000);
});
