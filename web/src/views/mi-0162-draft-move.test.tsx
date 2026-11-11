import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { seam, songs, status } from '../test/backend';
import { Mix } from './Mix';
import { MixScope } from './mixScope';
import { movedLocally } from './optimisticMove';

/** MI-0162-05: a keyboard move in a draft shows at once, keeps the server's answer, and is put back when
 * the server refuses it. The request still carries the order the server last confirmed. */

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend' });
const start = songs(ready('a'), ready('b'), ready('c'));
const titles = () => [...document.querySelectorAll('li.song[data-song-key]')].map((row) => row.querySelector('.song-select')?.textContent);

function Harness({ draft, current = false }: { draft: number; current?: boolean }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  const view = (
    <Mix status={status()} mix={mix} mixName="A draft" canUndo refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} draftPlace={null} />
  );
  return current ? view : <MixScope.Provider value={draft}>{view}</MixScope.Provider>;
}

/** A server whose answer to the move is held until the test lets it go. */
function heldMove() {
  const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  let answer!: (response: Response) => void;
  const held = new Promise<Response>((done) => { answer = done; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/mix/move')) {
      sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return held;
    }
    if (url.includes('/drafts')) return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
  return { sent, answer };
}

afterEach(() => vi.unstubAllGlobals());

describe('MI-0162-05 a draft move is shown before the server answers', () => {
  it('moves the row at once, keeps focus on its grip, and keeps the server answer', async () => {
    const server = heldMove();
    render(<Harness draft={7} />);
    screen.getByRole('button', { name: 'Reorder Song 3' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    // shown while the request is still unanswered
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2', 'Song 4']));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Song 3' })));
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0].url).toContain('draft=7');
    expect(server.sent[0].body).toEqual({ source: 2, target: 1 });
    // the guard is the order the server knows, not the one shown
    expect(JSON.stringify(server.sent[0].headers)).toContain('1,2,3,4');
    const answer = { mix: movedLocally(start, 2, 1), name: 'A draft', can_undo: true, draft: { id: 7, place: null } };
    server.answer(new Response(JSON.stringify(answer), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reorder Song 3' }).closest('li')?.getAttribute('aria-busy')).toBeNull());
    expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2', 'Song 4']);
  });

  it('puts the draft back, with focus on the same grip, when the server refuses the move', async () => {
    const server = heldMove();
    render(<Harness draft={7} />);
    screen.getByRole('button', { name: 'Reorder Song 3' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2', 'Song 4']));
    server.answer(new Response(JSON.stringify({ detail: 'The mix changed.', code: 'mix_changed' }), { status: 409 }));
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4']));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Song 3' })));
  });

  it('leaves the current mix as the server has it until the answer, because the player plays from it', async () => {
    heldMove();
    render(<Harness draft={0} current />);
    screen.getByRole('button', { name: 'Reorder Song 3' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    await new Promise((done) => setTimeout(done, 50));
    expect(titles()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4']);
  });
});

describe('movedLocally mirrors the server move', () => {
  const ids = (mix: MixItem[]) => mix.map((item) => [item.song_id, item.position, item.seam?.state.status ?? null]);
  it('renumbers and marks the three new pairs as not rendered, like move_song', () => {
    expect(ids(movedLocally(start, 3, 1))).toEqual([
      [1, 0, null], [4, 1, 'none'], [2, 2, 'none'], [3, 3, 'none'],
    ]);
    expect(ids(movedLocally(start, 0, 2))).toEqual([
      [2, 0, null], [3, 1, 'ready'], [1, 2, 'none'], [4, 3, 'none'],
    ]);
  });
});
