import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SetPlayer } from './player';
import { fakeBackend, seam, songs, status } from './test/backend';
import { clearToasts } from './ui/toasts';
import { draftMovesWaiting, MoveQueue } from './views/optimisticMove';

/** rv-root: a move still on its way in one draft must not stop another draft from opening. The read
 * guard (MI-0162-05) is about moves already on screen in the draft being read, and a draft that has
 * not been shown yet has none. */

const list = (drafts: { id: number; name: string }[]) => ({
  drafts: drafts.map((draft) => ({ songs: 2, seconds: 400, seams: 1, ready: 0, failed: 0, waiting: 1, rendering: false, place: null, eta: null, to_render: 60, missing: 0, ...draft })),
  current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
});
const current = { mix: songs(seam('ready', 'a')), name: 'Current', can_undo: false };
const friday = { mix: songs(seam('none', 'b')), name: 'Friday', can_undo: true, draft: { id: 7, place: null } };

let release: (() => void) | null = null;

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
});

afterEach(async () => {
  release?.();
  release = null;
  await vi.waitFor(() => expect(draftMovesWaiting()).toBe(false));
});

describe('opening a draft while another draft has a move on its way', () => {
  it('still shows the draft rather than its loading skeleton', async () => {
    // a move in draft 3 that the server has not answered yet
    const other = new MoveQueue();
    const shown = { mix: [], name: 'Other', can_undo: false, draft: { id: 3, place: null } };
    void other.add(shown, () => new Promise((done) => { release = () => done(shown); }));
    expect(draftMovesWaiting()).toBe(true);
    window.history.pushState({}, '', '/mixes/drafts/7/edit');
    fakeBackend({
      'GET /status': status(),
      'GET /vibes': [],
      'GET /drafts': list([{ id: 7, name: 'Friday' }, { id: 3, name: 'Other' }]),
      'GET /mix': (_body: unknown, url: string) => (url.includes('draft=7') ? friday : current),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Friday' }, { timeout: 3000 })).toBeInTheDocument();
  });
});
