import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, status as appStatus } from '../test/backend';
import { Links } from './Links';

/**
 * S4-0104-02: a word connection's preview is only "ready" once the render it asked for has really
 * come back. A slow render stays a render in progress, a failed one says so and offers no clip, and
 * a render that fell back to another move says what was asked and what you would really hear.
 */
const link = {
  phrase: 'tonight', kind: 'x', a: 1, b: 2, artist_a: 'A', title_a: 'One', artist_b: 'B', title_b: 'Two',
  line_a: 'all tonight', line_b: 'tonight we go', moves: ['word_cut', 'word_blend'], move: 'word_cut',
  state: { status: 'none', key: 'planned-key' }, worked: false,
};
const props = () => ({
  setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), mix: [], tab: 'words' as const,
  status: appStatus({ moves: { word_cut: 'Word cut', word_blend: 'Word blend' } }),
}) as unknown as Parameters<typeof Links>[0];

const routes = (seams: unknown, poll?: unknown) => fakeBackend({
  'GET /links': { links: [link], prepared: 1, preparing: 0 },
  'GET /drafts': { drafts: [], current: {}, out_of_room: false },
  'POST /seams': seams,
  ...(poll ? { 'GET /seams/slow-key': poll } : {}),
});

const evidence = () => document.querySelector('.link-evidence')?.getAttribute('data-evidence');

afterEach(() => vi.useRealTimers());

describe('S4-0104-02 preview-ready is not the same as render requested', () => {
  it('a slow render stays in progress across polls, with no clip and no ready claim', async () => {
    const calls = routes({ status: 'rendering', key: 'slow-key' }, { status: 'rendering', key: 'slow-key' });
    render(<Links {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render it now' }, { timeout: 8000 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rendering…' })).toBeDisabled());
    // two of the card's 1.5 s polls pass and the server still says rendering
    await waitFor(() => expect(calls.filter((call) => call.path === '/seams/slow-key').length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Rendering…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Play it' })).toBeNull();
    expect(screen.queryByText(/, ready$/)).toBeNull();
    expect(evidence()).toBe('candidate');
    expect(document.querySelector('audio')).toBeNull();
  });

  it('a failed render says it failed, keeps the pair a candidate and offers to try again', async () => {
    routes({ status: 'failed', key: 'failed-key', error: 'No safe vocal runway.' });
    render(<Links {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render it now' }, { timeout: 8000 }));
    expect(await screen.findByText('No safe vocal runway.')).toBeInTheDocument();
    expect(screen.getByText('Word cut won’t work here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Play it' })).toBeNull();
    expect(evidence()).toBe('failed');
  });

  it('a render that came back as another move says what was asked and what you would hear', async () => {
    routes({ status: 'ready', key: 'fell-key', passed: true, label: 'Word blend', style: 'word_blend', fell_back: true });
    render(<Links {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render it now' }, { timeout: 8000 }));
    expect(await screen.findByText('Word blend will play, because Word cut wouldn’t work here')).toBeInTheDocument();
    expect(screen.getByText('You asked for Word cut. What you’d hear is Word blend.')).toBeInTheDocument();
    expect(evidence()).toBe('rendered');
  });

  it('asking for a render is not a preview: Play it appears only once the server says ready', async () => {
    let answer: (value: Response) => void = () => {};
    routes({ status: 'ready', key: 'unused' });
    const backend = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/seams') && init?.method === 'POST') return new Promise<Response>((resolve) => { answer = resolve; });
      return backend(url, init);
    }));
    render(<Links {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render it now' }, { timeout: 8000 }));
    // requested, not answered: nothing to play and the pair is still only a candidate
    expect(screen.queryByRole('button', { name: 'Play it' })).toBeNull();
    expect(evidence()).toBe('candidate');
    await act(async () => {
      answer(new Response(JSON.stringify({ status: 'ready', key: 'answered-key', passed: true, label: 'Word cut', style: 'word_cut' }), { status: 200 }));
    });
    expect(await screen.findByRole('button', { name: /Play it|Hide/ })).toBeInTheDocument();
    expect(evidence()).toBe('rendered');
    vi.unstubAllGlobals();
  });
});
