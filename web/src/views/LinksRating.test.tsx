import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, status as appStatus } from '../test/backend';
import { Links } from './Links';

// S4-0104-04: a Good/Bad rating belongs to the exact transition version that was heard.
// Changing the move while the rating is still being saved can't let the older answer
// overwrite the newer render on the card.
describe('rating a word connection while its move changes', () => {
  const link = {
    phrase: 'tonight', kind: 'x', a: 1, b: 2, artist_a: 'A', title_a: 'One', artist_b: 'B', title_b: 'Two',
    line_a: 'all tonight', line_b: 'tonight we go', moves: ['word_cut', 'word_blend'], move: 'word_cut',
    state: { status: 'ready', key: 'heard-key', passed: true }, worked: true,
  };
  const props = () => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const }) as unknown as Parameters<typeof Links>[0];

  it('sends the rating for the heard key, and the late answer does not replace the new move', async () => {
    let answerRating: (value: Response) => void = () => {};
    const calls = fakeBackend({
      'GET /links': { links: [link], prepared: 1, preparing: 0 },
      'GET /drafts': { drafts: [], current: {}, out_of_room: false },
      'POST /seams': { status: 'rendering', key: 'new-key' },
    });
    const backend = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/seams/heard-key/rate')) {
        calls.push({ method: 'POST', path: '/seams/heard-key/rate', body: JSON.parse(String(init?.body)) });
        return new Promise<Response>((resolve) => { answerRating = resolve; });
      }
      return backend(url, init);
    }));
    render(<Links {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Good' }));
    const blend = screen.getByRole('button', { name: /word_blend|Word blend/i });
    fireEvent.click(blend);
    await waitFor(() => expect(calls.some((call) => call.path === '/seams' && (call.body as { move: string }).move === 'word_blend')).toBe(true));
    await act(async () => {
      answerRating(new Response(JSON.stringify({ status: 'ready', key: 'heard-key', passed: true, rating: 'good' }), { status: 200 }));
    });
    expect(calls.find((call) => call.path === '/seams/heard-key/rate')?.body).toEqual({ rating: 'good' });
    // the card now follows the newer render, not the rated older version
    await waitFor(() => expect(screen.getByRole('button', { name: /Rendering/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Good', pressed: true })).toBeNull();
    expect(blend).toHaveAttribute('aria-pressed', 'true');
  });
});
