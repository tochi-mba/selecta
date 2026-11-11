import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { status } from '../test/backend';
import { Mixes } from './Mixes';

/**
 * S4-0097-06: the destination song search tells duplicate titles apart, never lets an older search
 * answer replace a newer one, says when it could not search, and words the ending as an aim rather
 * than a promise.
 */
const card: VibeCard = {
  key: 'pick', name: 'Selecta’s pick', group: '', family: null, blurb: 'words', songs: 40, ready: true, needs: 0,
  artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900,
};
const row = (id: number, title: string, artist: string) => ({
  id, title, artist, genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false,
});

type Pending = { query: string; answer: (rows: unknown) => void; fail: () => void };

function backend() {
  const searches: Pending[] = [];
  const steers: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    if (path.startsWith('/vibes')) return new Response(JSON.stringify([card]), { status: 200 });
    if (path.startsWith('/songs?')) {
      const query = new URLSearchParams(path.split('?')[1]).get('q') ?? '';
      return new Promise<Response>((resolve) => {
        searches.push({
          query,
          answer: (rows) => resolve(new Response(JSON.stringify(rows), { status: 200 })),
          fail: () => resolve(new Response(JSON.stringify({ detail: 'down' }), { status: 500 })),
        });
      });
    }
    if (path === '/steer' && init?.method === 'POST') {
      steers.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
  return { searches, steers };
}

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Mixes status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />,
  );
}

async function openSearch() {
  fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
  return screen.findByLabelText('Take me to');
}

afterEach(() => vi.unstubAllGlobals());

describe('S4-0097-06 destination song search', () => {
  it('two songs with the same title and artist are told apart and choosing one sends that exact song', async () => {
    const { searches, steers } = backend();
    show();
    fireEvent.change(await openSearch(), { target: { value: 'midnight' } });
    await waitFor(() => expect(searches).toHaveLength(1));
    searches[0].answer([row(7, 'Midnight', 'Same Artist'), row(8, 'Midnight', 'Same Artist'), row(9, 'Midnight', 'Other Artist')]);
    const list = within(await screen.findByRole('listbox', { name: 'Destination songs' }));
    expect(await list.findByRole('button', { name: 'Midnight - Same Artist (song 7)' })).toBeInTheDocument();
    expect(list.getByRole('button', { name: 'Midnight - Same Artist (song 8)' })).toBeInTheDocument();
    // a title shared only with a different artist needs no extra label
    expect(list.getByRole('button', { name: 'Midnight - Other Artist' })).toBeInTheDocument();
    fireEvent.click(list.getByRole('button', { name: 'Midnight - Same Artist (song 8)' }));
    await waitFor(() => expect(steers).toContainEqual(expect.objectContaining({ action: 'take_me_to', value: '8' })));
    expect(steers).not.toContainEqual(expect.objectContaining({ value: '7' }));
  });

  it('a slow answer to an older search never replaces the newer one', async () => {
    const { searches } = backend();
    show();
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'mid' } });
    await waitFor(() => expect(searches).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'midnight' } });
    await waitFor(() => expect(searches).toHaveLength(2));
    expect(searches.map((search) => search.query)).toEqual(['mid', 'midnight']);
    searches[1].answer([row(7, 'Midnight', 'New Answer')]);
    const list = within(await screen.findByRole('listbox', { name: 'Destination songs' }));
    expect(await list.findByRole('button', { name: 'Midnight - New Answer' })).toBeInTheDocument();
    searches[0].answer([row(3, 'Middle', 'Old Answer')]);
    await new Promise((done) => setTimeout(done, 50));
    expect(list.queryByRole('button', { name: 'Middle - Old Answer' })).toBeNull();
    expect(list.getByRole('button', { name: 'Midnight - New Answer' })).toBeInTheDocument();
  });

  it('a failed search says so with a retry instead of claiming nothing matches', async () => {
    const { searches } = backend();
    show();
    fireEvent.change(await openSearch(), { target: { value: 'midnight' } });
    await waitFor(() => expect(searches).toHaveLength(1));
    searches[0].fail();
    expect(await screen.findByText('Couldn’t search ready songs.')).toBeInTheDocument();
    expect(screen.queryByText('No ready songs match yet.')).toBeNull();
  });

  it('the ending is worded as an aim, never a guarantee', async () => {
    backend();
    show();
    await openSearch();
    expect(screen.getByText(/finishes as near as it can/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/will (always )?(end|finish) on|guarantee/i);
  });
});
