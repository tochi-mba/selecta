import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, Reply, status as appStatus } from '../test/backend';
import { HarmonicDiscoveries, Links } from './Links';

/** GP-0260: Discovery hands a pair to Create only through one exact, ordered, guarded call. Auditions,
 * renders, ratings and chord verdicts never touch a mix; the add line names its target and says whether
 * the transition is rendered or still only a word match; a stale or rejected add changes nothing here. */

const MIX_ROUTES = /^\/mix(\/|\?|$)/;
const ready = { status: 'ready', key: 'k-ready', label: 'Word blend', style: 'word_blend', passed: true };
const link = (state: Record<string, unknown> = { status: 'none', key: 'k' }) => ({
  phrase: 'tonight', kind: 'end-start', a: 21, b: 34, artist_a: 'A', title_a: 'One', artist_b: 'B', title_b: 'Two',
  line_a: 'all tonight', line_b: 'tonight we go', moves: ['word_blend', 'word_cut'], move: 'word_blend', state, worked: true,
});
const props = () => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const }) as unknown as Parameters<typeof Links>[0];
const discovery = { id: 7, song_a: 71, song_b: 72, title_a: 'First', title_b: 'Second', artist_a: 'A', artist_b: 'B', status: 'new', payload: { a_at: 1, b_at: 2, bars: 4, transpose: 0 } };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('GP-0260-01/06 auditions and verdicts never change a mix', () => {
  it('a chord match can be heard, answered and changed, and no mix route is ever called', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery, { ...discovery, id: 8, song_a: 81, song_b: 82 }],
      'POST /discoveries/7/hear': { chords: ['C', 'G'], bar_starts: [0, 2], seconds: 4, semitones: 0 },
      'POST /discoveries/8/hear': { chords: ['C', 'G'], bar_starts: [0, 2], seconds: 4, semitones: 0 },
      'POST /discoveries/7/review': { ok: true },
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await screen.findByRole('button', { name: /Hear what Selecta heard/ }));
    await screen.findByRole('list', { name: 'Four stages to hear' });
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/discoveries/7/review')).toBe(true));
    expect(screen.getByText(/It never adds anything to a mix/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
    expect(calls.filter((call) => MIX_ROUTES.test(call.path))).toEqual([]);
  });

  it('rendering, playing and rating a word connection only touch its seam', async () => {
    const shown = props();
    const calls = fakeBackend({
      'GET /links': { links: [link(ready)], prepared: 1, preparing: 1 },
      'GET /drafts': { drafts: [] },
      'POST /seams': { ...ready, key: 'k-cut', label: 'Word cut', style: 'word_cut' },
      'POST /seams/k-cut/rate': { ...ready, key: 'k-cut', rating: 'good' },
    });
    render(<Links {...shown} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play it' }));
    fireEvent.click(screen.getByRole('button', { name: 'word_cut' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/seams' && call.method === 'POST')).toBe(true));
    expect(calls.filter((call) => MIX_ROUTES.test(call.path))).toEqual([]);
    expect(shown.setMixData).not.toHaveBeenCalled();
    expect(shown.setView).not.toHaveBeenCalled();
  });
});

describe('GP-0260-02/03 the add names the exact ordered pair, its target and its effect', () => {
  it('sends source then destination with the order it saw, and says it went into the current mix', async () => {
    const shown = { ...props(), mix: [{ song_id: 5 }, { song_id: 9 }] } as unknown as Parameters<typeof Links>[0];
    const calls = fakeBackend({ 'GET /links': { links: [link()], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [] }, 'POST /mix/pair': { mix: [], name: 'Mix', can_undo: true } });
    render(<Links {...shown} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both to the mix' }));
    await waitFor(() => expect(shown.notify).toHaveBeenCalledWith('Added “tonight” to your mix.', true));
    expect(calls.find((call) => call.path === '/mix/pair')?.body).toEqual({ a: 21, b: 34, move: 'word_blend', phrase: 'tonight' });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/mix/pair', expect.objectContaining({ headers: expect.objectContaining({ 'x-mix-order': '5,9' }) }));
  });

  it('a draft target is named, checked against that draft’s own order, and leaves what’s playing alone', async () => {
    const shown = props();
    const calls = fakeBackend({
      'GET /links': { links: [link()], prepared: 0, preparing: 0 },
      'GET /drafts': { drafts: [{ id: 3, name: 'Sunday' }] },
      'GET /mix': { mix: [{ song_id: 8 }], name: 'Sunday', can_undo: false },
      'POST /mix/pair': { mix: [], name: 'Sunday', can_undo: true },
    });
    render(<Links {...shown} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both to…' }));
    expect(screen.getByRole('menuitem', { name: 'Your current mix' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sunday' }));
    await waitFor(() => expect(shown.notify).toHaveBeenCalledWith('Added “tonight” to Sunday. What’s playing hasn’t changed.'));
    expect(calls.some((call) => call.path === '/mix?draft=3')).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/mix/pair?draft=3', expect.objectContaining({ headers: expect.objectContaining({ 'x-mix-order': '8' }) }));
    expect(shown.setMixData).not.toHaveBeenCalled();
    expect(shown.setView).not.toHaveBeenCalled();
  });
});

describe('GP-0260-05 a stale, reversed or missing pair changes nothing here', () => {
  for (const [why, detail] of [
    ['the mix changed since the page looked', 'This mix has just changed, so nothing was done.'],
    ['both songs are already there, in either order', 'Those two songs are both in this mix already.'],
    ['a song has left the library', 'One of those songs is no longer in your library.'],
  ]) {
    it(`refuses when ${why}`, async () => {
      const shown = props();
      fakeBackend({ 'GET /links': { links: [link()], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [] }, 'POST /mix/pair': new Reply(409, { detail }) });
      render(<Links {...shown} />);
      const add = await screen.findByRole('button', { name: 'Add both to the mix' });
      fireEvent.click(add);
      await waitFor(() => expect(add).not.toHaveAttribute('aria-busy'));
      expect(shown.setMixData).not.toHaveBeenCalled();
      expect(shown.setView).not.toHaveBeenCalled();
      expect(shown.notify).not.toHaveBeenCalled();
    });
  }
});

describe('GP-0260-07 the add line says whether the transition exists yet', () => {
  for (const [state, evidence, words] of [
    [{ status: 'none', key: 'k' }, 'candidate', /isn’t rendered yet: the shared words are a match to check/],
    [{ status: 'queued', key: 'k' }, 'candidate', /isn’t rendered yet/],
    [{ status: 'failed', key: 'k', error: 'no' }, 'failed', /didn’t render, so for now the shared words are only a match to check/],
    [ready, 'rendered', /rendered and is what you’d hear/],
    [{ ...ready, passed: false }, 'rendered', /rendered, with a rough spot/],
  ] as const) {
    it(`${state.status}${'passed' in state && state.passed === false ? ' with a warning' : ''}`, async () => {
      fakeBackend({ 'GET /links': { links: [link(state)], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [] } });
      const { container } = render(<Links {...props()} />);
      await screen.findByRole('button', { name: 'Add both to the mix' });
      const line = container.querySelector('.link-evidence');
      expect(line).toHaveAttribute('data-evidence', evidence);
      expect(line?.textContent).toMatch(words);
      expect(screen.getByRole('button', { name: 'Add both to the mix' })).toHaveAccessibleDescription(words);
    });
  }
});
