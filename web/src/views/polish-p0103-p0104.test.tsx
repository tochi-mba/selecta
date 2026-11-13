/* P0103 and P0104 (ADR-0040 Library polish), the parts that need no browser.
 * P0103: the filter, query, page depth and focus survive song details, a refused correction, a failed
 * save and the way back. P0104: a 20,000-song library pages without remounting what is already shown,
 * keeps focus on "Show more songs", and a search keeps focus in its box.
 * The browser twins (real layout, scroll and timing) are MP-0291-06 and MP-0291-07 in
 * web/e2e/mp-0291-library.e2e.ts. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, Reply, status } from '../test/backend';
import { Library } from './Library';

const row = (id: number, title: string, more: Record<string, unknown> = {}) => ({
  id,
  artist: `Artist ${id % 300}`,
  title,
  genre: null,
  duration: 200,
  bpm: 120 as number | null,
  camelot: '8A' as string | null,
  lyric_status: null,
  never: false,
  priority: false,
  detected_bpm: 120 as number | null,
  detected_camelot: '8A' as string | null,
  override_bpm: null as number | null,
  override_camelot: null as string | null,
  music_override: null,
  energy: null,
  grid_confidence: null,
  readiness: { status: 'ready', reason: '' },
  ...more,
});

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library
      status={status()}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={vi.fn()}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

afterEach(() => {
  setPrefs({ libraryLayout: 'list', density: 'comfortable' });
  vi.unstubAllGlobals();
});

describe('P0103 filter, query and focus survive details, a refused value, a failed save and the way back', () => {
  beforeEach(() => window.history.pushState({}, '', '/library?q=Night&show=ready'));

  it('keeps everything the listener set up, and puts focus back on the song they opened', async () => {
    const list = [row(1, 'Night One'), row(2, 'Night Two'), row(3, 'Night Three')];
    const calls = fakeBackend({
      'GET /library': { songs: list, total: list.length, next: null },
      'POST /songs/2/correct': new Reply(500, { detail: 'SelectaDJ had a problem saving that.' }),
    });
    show();
    const opener = await screen.findByRole('button', { name: 'Details for Night Two' });
    // the list was asked for with the query and filter from the address
    const asked = calls.find((call) => call.path.startsWith('/library?'))!.path;
    expect(asked).toContain('q=Night');
    expect(asked).toContain('state=ready');
    await userEvent.click(opener);
    const details = screen.getByRole('dialog');
    const tempo = within(details).getByRole('textbox', { name: /^Tempo/ });

    // a value Selecta refuses: the message belongs to its own field, focus goes there, nothing is sent
    await userEvent.clear(tempo);
    await userEvent.type(tempo, '400');
    await userEvent.click(within(details).getByRole('button', { name: 'Save correction' }));
    const field = tempo.closest('.field')!;
    const fieldError = field.querySelector<HTMLElement>('[id$="-error"]')!;
    expect(fieldError).toBeInTheDocument();
    expect(tempo).toHaveAttribute('aria-invalid', 'true');
    expect(tempo.getAttribute('aria-describedby')).toContain(fieldError.id);
    // the error follows its own field's control, inside the same field, not elsewhere in the sheet
    expect(tempo.compareDocumentPosition(fieldError) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tempo).toHaveFocus();
    expect(tempo).toHaveValue('400');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    // a value it accepts, but the server fails: what was typed stays, and the problem takes focus
    await userEvent.clear(tempo);
    await userEvent.type(tempo, '128');
    await userEvent.click(within(details).getByRole('button', { name: 'Save correction' }));
    const problem = await within(details).findByText('SelectaDJ had a problem saving that.');
    await waitFor(() => expect(problem).toHaveFocus(), { timeout: 3000 });
    expect(tempo).toHaveValue('128');

    // the way back: the sheet closes, focus returns to the song that opened it, and the search,
    // the filter and the address are exactly as they were
    await userEvent.click(within(details).getByRole('button', { name: /^Close / }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Details for Night Two' })).toHaveFocus();
    expect(screen.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('Night');
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'true');
    const address = new URLSearchParams(window.location.search);
    expect(address.get('q')).toBe('Night');
    expect(address.get('show')).toBe('ready');
    expect(address.get('song')).toBeNull();
  });

  it('Escape closes the details the same way, keeping the query and the opener focused', async () => {
    const list = [row(1, 'Night One'), row(2, 'Night Two')];
    fakeBackend({ 'GET /library': { songs: list, total: list.length, next: null } });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Details for Night One' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Details for Night One' })).toHaveFocus();
    expect(screen.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('Night');
  });
});

describe('P0104 a 20,000-song library pages and searches without losing place or focus', () => {
  beforeEach(() => window.history.pushState({}, '', '/library'));

  it('Show more appends pages, keeps rows already shown mounted, and keeps focus on the button', async () => {
    const TOTAL = 20_000;
    fakeBackend({
      'GET /library': (_body: unknown, path: string) => {
        const url = new URL(path, 'http://x');
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const after = Number(url.searchParams.get('after') ?? 0);
        const q = url.searchParams.get('q') ?? '';
        const total = q ? 1200 : TOTAL;
        const songs = Array.from({ length: Math.min(limit, total - after) }, (_, index) => {
          const position = after + index + 1;
          return row(100_000 + position + (q ? 50_000 : 0), `${q ? `${q} ` : ''}Synthetic Recording ${position}`);
        });
        return { songs, total, next: after + limit < total ? String(after + limit) : null };
      },
    });
    show();
    expect(await screen.findByText('Showing 100 of 20000 songs.')).toBeInTheDocument();
    const firstShown = document.querySelector('.library-rows .song-row');
    const fortieth = document.querySelectorAll('.library-rows .song-row')[40];
    const more = screen.getByRole('button', { name: 'Show more songs' });
    for (let round = 0; round < 3; round += 1) {
      more.focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(document.querySelectorAll('.library-rows .song-row')).toHaveLength(200 + round * 100));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show more songs' })).toHaveFocus());
    }
    expect(screen.getByText('Showing 400 of 20000 songs.')).toBeInTheDocument();
    // the rows already on screen are the same nodes: nothing above the new page was rebuilt or moved
    expect(document.querySelector('.library-rows .song-row')).toBe(firstShown);
    expect(document.querySelectorAll('.library-rows .song-row')[40]).toBe(fortieth);
    // only the page that was asked for is drawn, never all 20,000
    expect(document.querySelectorAll('.library-rows .song-row').length).toBeLessThanOrEqual(400);

    // a search narrows the list and the box keeps the focus while the answer arrives
    const search = screen.getByRole('searchbox', { name: 'Search your library' });
    await userEvent.click(search);
    await userEvent.type(search, 'Night');
    expect(await screen.findByText('Showing 100 of 1200 songs.', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(document.querySelectorAll('.library-rows .song-row')).toHaveLength(100);
    // 400 full rows in jsdom are slow to draw on a loaded machine; the timing itself is MP-0291-07's job
  }, 60_000);
});
