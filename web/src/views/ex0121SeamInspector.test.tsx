import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixItem, SeamOptions } from '../api';
import { seam, songs } from '../test/backend';
import { seamLayers } from '../ui/seam';
import { InspectorTab, SeamInspector } from './SeamInspector';

/** EX-0121 (Experience programme, Transition Inspector): what was asked for, what is being made, what
 * exists and what would be heard stay apart; every server choice and explanation is shown; nothing
 * unrendered is offered as playable; and a rating or edit only ever lands on the seam it was made on. */

const names = { bass_swap_blend: 'Blend', word_blend: 'Word blend', vocal_ride: 'Vocal ride', cut_on_one: 'Cut' };
const options: SeamOptions = {
  moves: [
    { name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null },
    { name: 'cut_on_one', label: 'Cut', description: 'Cut on the one.', available: true, reason: null },
    { name: 'vocal_ride', label: 'Vocal ride', description: '', available: false, reason: 'Song 2 has no clear vocal entry' },
    { name: 'word_blend', label: 'Word blend', description: '', available: false, reason: 'No shared lyric was found' },
  ],
  exits: [{ bar: 32, time: 64, kind: 'phrase' }, { bar: 48, time: 96, kind: 'drop' }],
  entries: [{ bar: 8, time: 16, kind: 'phrase' }],
  lengths: [],
  links: [],
  tempo_gap: 2,
  keys: ['8A', '9A'],
} as unknown as SeamOptions;

type Route = (url: string, init?: RequestInit) => Promise<Response> | Response;
const calls: { method: string; url: string; headers: Headers; body: unknown }[] = [];
function backend(extra: Route = () => new Response('{}', { status: 200 })) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(init.body as string) : null });
    if (url.includes('/options')) return new Response(JSON.stringify(options), { status: 200 });
    return extra(url, init);
  }));
}
afterEach(() => vi.unstubAllGlobals());

function inspector(item: MixItem, previous: MixItem, tab: InspectorTab) {
  return (
    <SeamInspector
      item={item} previous={previous} names={names} refreshMix={() => {}} notify={() => {}}
      guard={{ 'x-mix-order': '1,2' }} tab={tab} setTab={() => {}} autoPlay={false} onClose={() => {}}
    />
  );
}

describe('EX-0121-01 requested, in progress, made and heard are never conflated', () => {
  const chosen = { move: 'cut_on_one', bars: 8 };
  it.each(['none', 'queued', 'rendering', 'failed'] as const)('a %s seam names the request but never claims audio exists', (status) => {
    const layers = seamLayers({ settings: chosen, state: { status, key: 'k', passed: true } } as never, names);
    expect(layers.requested).toBe('Cut, 8 bars');
    expect(layers.heard).toMatch(/^Nothing yet/);
    expect(layers.version).toBeNull();
    expect(layers.fellBack).toBe(false);
    expect(layers.rendered).toBe(status === 'failed' ? 'Couldn’t be made' : null);
    expect(layers.inProgress).toBe(status === 'rendering' ? 'Rendering now' : status === 'queued' ? 'Waiting in line' : null);
  });

  it('a ready seam that fell back keeps the request and says what will really be heard', () => {
    const layers = seamLayers({ settings: chosen, state: { status: 'ready', key: 'abcdef123', passed: true, label: 'Blend', style: 'bass_swap_blend', bars: 16 } } as never, names);
    expect(layers).toMatchObject({ requested: 'Cut, 8 bars', rendered: 'Blend, 16 bars', heard: 'Blend', fellBack: true, version: 'abcdef' });
  });

  it('the Listen tab shows the four layers as separate, labelled facts', () => {
    backend();
    const [previous, item] = songs({ settings: { move: 'cut_on_one' }, state: { status: 'ready', key: 'r1', passed: true, label: 'Blend', style: 'bass_swap_blend' } } as never);
    render(inspector(item, previous, 'listen'));
    const layers = document.querySelector('dl.seam-layers')!;
    const fact = (term: string) => within(layers as HTMLElement).getByText(term).nextElementSibling;
    expect(fact('You chose')).toHaveTextContent('Cut');
    expect(fact('In progress')).toHaveTextContent('Nothing right now');
    expect(fact('Made so far')).toHaveTextContent('Blend');
    expect(fact('You’d hear')).toHaveTextContent('Blend, which isn’t what you chose');
  });
});

describe('EX-0121-02 every seam choice and explanation stays reachable', () => {
  it('shows every server move, greys out the unavailable ones with their reasons, and every cue', async () => {
    backend();
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(inspector(item, previous, 'change'));
    for (const move of options.moves) {
      const button = await screen.findByRole('button', { name: move.label });
      if (move.available) expect(button).toBeEnabled();
      else expect(button).toBeDisabled();
    }
    const why = screen.getByText('Why 2 moves are greyed out').closest('details')!;
    expect(why).toHaveTextContent('Vocal ride: Song 2 has no clear vocal entry');
    expect(why).toHaveTextContent('Word blend: No shared lyric was found');
    expect(screen.getByText('2% tempo gap, keys 8A and 9A.')).toBeInTheDocument();
    expect(screen.getByText('What do these music terms mean for this transition?')).toBeInTheDocument();
    for (const bars of ['Pick for me', '4 bars', '8 bars', '16 bars']) expect(screen.getByRole('button', { name: bars })).toBeEnabled();
    const leave = screen.getByLabelText(/Leave .* at/);
    const bring = screen.getByLabelText(/Bring in .* at/);
    expect(within(leave).getAllByRole('option').map((option) => option.textContent)).toEqual(['Wherever’s best', '1:04, phrase', '1:36, drop']);
    expect(within(bring).getAllByRole('option').map((option) => option.textContent)).toEqual(['Wherever’s best', '0:16, phrase']);
  });

  it('every enabled choice is reached with Tab alone, in reading order', async () => {
    backend();
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(inspector(item, previous, 'change'));
    await screen.findByRole('button', { name: 'Cut' });
    const wanted = ['Blend', 'Cut', 'Pick for me', '4 bars', '8 bars', '16 bars'];
    const reached: string[] = [];
    for (let step = 0; step < 40 && reached.length < 60; step += 1) {
      await userEvent.tab();
      const active = document.activeElement as HTMLElement;
      if (active === document.body) break;
      reached.push(active.getAttribute('aria-label') ?? active.textContent ?? '');
    }
    for (const label of wanted) expect(reached).toContain(label);
    expect(reached.indexOf('Blend')).toBeLessThan(reached.indexOf('16 bars'));
    expect(reached.some((label) => label.startsWith('Wherever’s best'))).toBe(true);
  });
});

describe('EX-0121-03 unrendered or failed transitions never look playable', () => {
  it.each(['none', 'queued', 'rendering', 'failed'] as const)('a %s seam has no audio, no rating and nothing to report', (status) => {
    backend();
    const [previous, item] = songs(seam(status, 'k1', { error: 'No safe runway' } as never));
    const view = render(inspector(item, previous, 'listen'));
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rate this seam' })).toBeNull();
    if (status === 'failed') expect(screen.getByText(/couldn’t be made/)).toBeInTheDocument();
    if (status === 'none') expect(screen.getByRole('button', { name: 'Render it' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: 'Render it' })).toBeNull();
    view.rerender(inspector(item, previous, 'details'));
    expect(screen.getByText('There’s nothing to report until this has been rendered.')).toBeInTheDocument();
  });

  it('only a ready seam gets audio, bound to its exact render key', () => {
    backend();
    const [previous, item] = songs(seam('ready', 'exact-key', { label: 'Blend', preview_seam: 20 }));
    render(inspector(item, previous, 'listen'));
    expect(document.querySelector('audio')).toHaveAttribute('src', '/api/seams/exact-key/preview');
  });
});

describe('EX-0121-05 feedback and edits never attach to a later seam', () => {
  it('a rating sent before a re-render lands on the render that was heard, and is not shown on the new one', async () => {
    let answer: (response: Response) => void = () => {};
    backend((url) => (url.includes('/rate') ? new Promise<Response>((done) => { answer = done; }) : new Response('{}')));
    const [previous, heard] = songs(seam('ready', 'heard-key', { label: 'Blend' }));
    const view = render(inspector(heard, previous, 'listen'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Rate this seam' })).getByRole('button', { name: 'Good' }));
    // the seam is re-rendered while the rating is still on its way
    const [, later] = songs(seam('ready', 'later-key', { label: 'Cut' }));
    view.rerender(inspector(later, previous, 'listen'));
    await act(async () => { answer(new Response('{}', { status: 200 })); });
    const rated = calls.filter((call) => call.url.includes('/rate'));
    expect(rated.map((call) => [call.url, call.body])).toEqual([['/api/seams/heard-key/rate', { rating: 'good' }]]);
    const thumbs = within(screen.getByRole('group', { name: 'Rate this seam' }));
    expect(thumbs.getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('audio')).toHaveAttribute('src', '/api/seams/later-key/preview');
  });

  it('an edit carries the order it was made against, so the server can refuse it after a reorder', async () => {
    backend((url) => (url.includes('/seam') ? new Response(JSON.stringify({ detail: 'The mix changed. Look again.' }), { status: 409 }) : new Response('{}')));
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(inspector(item, previous, 'change'));
    await userEvent.click(await screen.findByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The mix changed'));
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes.map((call) => [call.url, call.headers.get('x-mix-order')])).toEqual([['/api/mix/1/seam', '1,2']]);
    // refused, so nothing was rendered and the choice goes back to what the server has
    expect(screen.getByRole('button', { name: 'Blend' })).toHaveAttribute('aria-pressed', 'true');
  });
});
