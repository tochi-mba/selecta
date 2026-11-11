import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Link, MixItem } from '../api';
import { setFlags } from '../flags';
import type { NowState } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { FIRST_HANDOFF_KEY, FirstHandoff } from './FirstHandoff';
import { ScanReveals } from './ScanReveals';
import { Preparing } from './Setup';

const link = (a: number, b: number, phrase: string): Link => ({
  phrase, kind: 'word', a, b, artist_a: 'A', title_a: `Song ${a}`, artist_b: 'B', title_b: `Song ${b}`, line_a: '', line_b: '',
  moves: ['word_blend'], move: 'word_blend', state: { status: 'none', key: `${a}-${b}`, passed: true }, worked: false,
});
const list = (...links: Link[]) => ({ links, prepared: 0, preparing: 0 });

afterEach(() => {
  vi.unstubAllGlobals();
  setFlags(null);
  window.localStorage.clear();
});

describe('CI-0178-04 genuine new-musical-possibility reveals during the first scan', () => {
  it('names only the connections the server returned, newest first, and nothing more', async () => {
    let answer = list(link(3, 9, 'midnight'));
    fakeBackend({ 'GET /links': () => answer });
    const { rerender } = render(<ScanReveals ready={2} lyrics={4} />);
    expect(await screen.findByText('midnight')).toBeInTheDocument();
    const items = () => [...document.querySelectorAll('[data-link]')].map((item) => item.getAttribute('data-link'));
    expect(items()).toEqual(['3>9:midnight']);
    expect(screen.getByText(/Nothing has been added to a mix/)).toBeInTheDocument();
    // a new count from the server asks again; the new connection leads, the old one stays
    answer = list(link(3, 9, 'midnight'), link(5, 6, 'fire'));
    rerender(<ScanReveals ready={3} lyrics={4} />);
    await waitFor(() => expect(items()).toEqual(['5>6:fire', '3>9:midnight']));
  });

  it('shows nothing when the server has found nothing, or returns something that is not a real pair', async () => {
    const calls = fakeBackend({ 'GET /links': list(link(4, 4, 'self'), { ...link(1, 2, ''), phrase: '' }) });
    const { container } = render(<ScanReveals ready={1} lyrics={1} />);
    await waitFor(() => expect(calls.some((call) => call.path.startsWith('/links'))).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toBe('');
  });

  it('shows nothing when the server cannot be asked', async () => {
    const calls = fakeBackend({ 'GET /links': new Reply(500, { detail: 'broken' }) });
    const { container } = render(<ScanReveals ready={1} lyrics={1} />);
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toBe('');
  });

  it('is gone, and asks nothing, with its flag or word connections off; the readiness page still renders', async () => {
    for (const off of ['discover.scan_reveals', 'discover.word_links']) {
      const calls = fakeBackend({ 'GET /links': list(link(3, 9, 'midnight')) });
      setFlags({ [off]: false });
      const { unmount } = render(<Preparing status={status({ counts: { total: 9, music: 9, set_aside: 0, analysed: 3, ready: 2, lyrics: 2 } })} onAnalyse={vi.fn()} />);
      expect(screen.getByRole('heading', { name: 'Getting your songs ready.' })).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });
      expect(calls.filter((call) => call.path.startsWith('/links'))).toEqual([]);
      expect(document.querySelector('[data-scan-reveals]')).toBeNull();
      unmount();
    }
  });

  it('appears on the readiness page while songs are prepared', async () => {
    fakeBackend({ 'GET /links': list(link(3, 9, 'midnight')) });
    render(<Preparing status={status({ counts: { total: 9, music: 9, set_aside: 0, analysed: 3, ready: 2, lyrics: 2 } })} onAnalyse={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Found in your library so far' })).toBeInTheDocument();
  });
});

const state = (more: Partial<NowState> = {}): NowState => ({
  phase: 'playing', position: 1, songTime: 3, duration: 200, inSeam: false, seamAt: null, notice: '',
  nextReady: true, lastSeamKey: null, volume: 1, muted: false, ...more,
});

describe('CI-0178-05 first-seam earned-reward moment', () => {
  const mix: MixItem[] = songs(seam('ready', 'k1'), seam('rendering', 'k2'));

  beforeEach(() => window.localStorage.clear());

  it('waits for a finished transition to be heard, then names the two songs without blocking anything', () => {
    const { rerender } = render(<FirstHandoff now={state()} mix={mix} />);
    // playing, but no transition has been heard yet: the plan alone earns nothing
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    rerender(<FirstHandoff now={state({ lastSeamKey: 'k1' })} mix={mix} />);
    const note = screen.getByRole('status', { name: 'Your first hand-off' });
    expect(note).toHaveTextContent('That was your first Selecta hand-off: Song 1 into Song 2');
    expect(note.tagName).toBe('ASIDE');
    expect(document.querySelector('dialog, [role="dialog"], [aria-modal]')).toBeNull();
  });

  it('is not triggered while paused, or by a transition that is not finished or not in this mix', () => {
    const { rerender } = render(<FirstHandoff now={state({ phase: 'paused', lastSeamKey: 'k1' })} mix={mix} />);
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    rerender(<FirstHandoff now={state({ lastSeamKey: 'k2' })} mix={mix} />);
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    rerender(<FirstHandoff now={state({ lastSeamKey: 'someone-else' })} mix={mix} />);
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    expect(window.localStorage.getItem(FIRST_HANDOFF_KEY)).toBeNull();
    // the Pause came first; once it really plays through, it is earned
    rerender(<FirstHandoff now={state({ lastSeamKey: 'k1' })} mix={mix} />);
    expect(screen.getByText(/first Selecta hand-off/)).toBeInTheDocument();
  });

  it('a Pause after it was earned leaves the note in place, and Got it dismisses it for good', () => {
    const { rerender, unmount } = render(<FirstHandoff now={state({ lastSeamKey: 'k1' })} mix={mix} />);
    rerender(<FirstHandoff now={state({ phase: 'paused', lastSeamKey: 'k1' })} mix={mix} />);
    expect(screen.getByText(/first Selecta hand-off/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    unmount();
    // another visit, another transition: it stays dismissed
    render(<FirstHandoff now={state({ lastSeamKey: 'k1' })} mix={mix} />);
    expect(screen.queryByText(/first Selecta hand-off/)).toBeNull();
    expect(window.localStorage.getItem(FIRST_HANDOFF_KEY)).toBe('1');
  });

  it('is gone with its flag off', () => {
    setFlags({ 'listen.first_handoff': false });
    const { container } = render(<FirstHandoff now={state({ lastSeamKey: 'k1' })} mix={mix} />);
    expect(container.innerHTML).toBe('');
    expect(window.localStorage.getItem(FIRST_HANDOFF_KEY)).toBeNull();
  });
});
