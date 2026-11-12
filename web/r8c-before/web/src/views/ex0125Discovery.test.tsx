import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, status as appStatus } from '../test/backend';
import { Links } from './Links';

/** EX-0125-05 (Experience programme, discovery): adding a word pair says which mix it went into, leaves
 * the other untouched, and offers an Undo bound to that same destination. */

const link = { phrase: 'tonight', kind: 'x', a: 1, b: 2, artist_a: 'A', title_a: 'One', artist_b: 'B', title_b: 'Two', line_a: 'all tonight', line_b: 'tonight we go', moves: ['word_cut'], move: 'word_cut', state: { status: 'none', key: 'k' }, worked: true };
const drafts = { drafts: [{ id: 7, name: 'Friday' }], current: {}, out_of_room: false };
const pairMix = (name: string) => ({ mix: [{ position: 0, song_id: 1 }, { position: 1, song_id: 2 }], name, can_undo: true });
const props = () => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const }) as unknown as Parameters<typeof Links>[0];

describe('EX-0125-05 add-to-mix names its destination and its Undo', () => {
  it('into what is playing: the current mix changes, and the Undo is for the current mix', async () => {
    fakeBackend({ 'GET /links': { links: [link], prepared: 0, preparing: 0 }, 'GET /drafts': { ...drafts, drafts: [] }, 'POST /mix/pair': pairMix('Mix') });
    const shown = props();
    render(<Links {...shown} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both to the mix' }));
    await waitFor(() => expect(shown.notify).toHaveBeenCalledWith('Added “tonight” to your mix.', true));
    expect(shown.setMixData).toHaveBeenCalledTimes(1);
  });

  it('into a draft: what is playing is untouched, and Undo takes back only that draft’s addition', async () => {
    const calls = fakeBackend({
      'GET /links': { links: [link], prepared: 0, preparing: 0 }, 'GET /drafts': drafts,
      'GET /mix': { mix: [], name: 'Friday', can_undo: false }, 'POST /mix/pair': pairMix('Friday'), 'POST /mix/undo': pairMix('Friday'),
    });
    const shown = props();
    render(<Links {...shown} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both to…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Friday' }));
    await waitFor(() => expect(shown.notify).toHaveBeenCalled());
    const [message, undo] = vi.mocked(shown.notify).mock.calls[0] as [string, () => Promise<void>];
    expect(message).toBe('Added “tonight” to Friday. What’s playing hasn’t changed.');
    expect(shown.setMixData).not.toHaveBeenCalled();
    expect(typeof undo).toBe('function');
    await undo();
    expect(calls.filter((call) => call.path.startsWith('/mix/undo')).map((call) => call.path)).toEqual(['/mix/undo?draft=7']);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/mix/undo?draft=7', expect.objectContaining({
      headers: expect.objectContaining({ 'x-mix-order': '1,2' }),
    }));
  });
});
