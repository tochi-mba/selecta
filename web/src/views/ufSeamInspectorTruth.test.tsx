import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { fakeBackend, seam, songs } from '../test/backend';
import { InspectorTab, SeamInspector } from './SeamInspector';

/** UF-0381-01/05/06/07: exact directed identity with a repeated song, guarded timing edits that say they
 * re-render, honest quality wording, and a Studio handoff for the exact pair. */

const names = { bass_swap_blend: 'Blend', cut_on_one: 'Cut' };
const options = {
  moves: [{ name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null }],
  exits: [{ bar: 32, time: 64, kind: 'phrase' }, { bar: 48, time: 96, kind: 'drop' }],
  entries: [{ bar: 8, time: 16, kind: 'phrase' }],
  lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
  studio: { available: true, reason: null },
};
afterEach(() => vi.unstubAllGlobals());

function show(item: MixItem, previous: MixItem, tab: InspectorTab, notify = vi.fn()) {
  let current = tab;
  const view = render(
    <SeamInspector
      item={item} previous={previous} names={names} refreshMix={() => {}} notify={notify}
      guard={{ 'x-mix-order': '1,2,1' }} tab={current} setTab={(next) => { current = next; }} autoPlay={false} onClose={() => {}}
    />,
  );
  return { view, notify, tab: () => current };
}

/** Song 1, Song 2, then Song 1 again: the second transition goes from Song 2 into the repeat of Song 1. */
function repeated(state = seam('ready', 'abcdef9999', { label: 'Blend', style: 'bass_swap_blend' })): [MixItem, MixItem] {
  const [first, second] = songs(seam('ready', 'first-key', { label: 'Blend' }));
  const again: MixItem = { ...first, position: 2, seam: state };
  return [second, again];
}

describe('UF-0381-01 the directed pair is exact when a song repeats', () => {
  it.each(['listen', 'change', 'details'] as const)('names transition 2, Song 2 into Song 1, its mix and version on %s', async (tab) => {
    fakeBackend({ 'GET /mix/2/options': options });
    const [previous, item] = repeated();
    show(item, previous, tab);
    const identity = document.querySelector('.inspector-identity') as HTMLElement;
    expect(identity.querySelector('.inspector-pair')).toHaveTextContent(/Song 2\s*→?\s*into\s*Song 1/);
    expect(within(identity).getByText('Transition 2')).toBeInTheDocument();
    expect(within(identity).queryByText('Transition 1')).toBeNull();
    expect(within(identity).getByText('In the current mix')).toBeInTheDocument();
    expect(within(identity).getByText('Version abcdef')).toBeInTheDocument();
    await screen.findAllByRole('tab');
  });
});

describe('UF-0381-05 timing edits are guarded and say they re-render', () => {
  it('a new exit cue goes to this transition with the order it was made against, then re-renders', async () => {
    const calls = fakeBackend({ 'GET /mix/2/options': options, 'POST /mix/2/seam': {}, 'POST /mix/2/render': {} });
    const headers: string[] = [];
    const fetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const original = fetch.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') headers.push(new Headers(init.headers).get('x-mix-order') ?? '');
      return original(url, init);
    });
    const [previous, item] = repeated();
    const { notify } = show(item, previous, 'change');
    const leave = await screen.findByLabelText(/Leave .* at/);
    await userEvent.selectOptions(leave, '48');
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Changed that seam. Rendering it now.', true));
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes.map((call) => call.path)).toEqual(['/mix/2/seam', '/mix/2/render']);
    expect(writes[0].body).toMatchObject({ exit_bar: 48, soft: false });
    expect(headers).toEqual(['1,2,1', '1,2,1']);
  });
});

describe('UF-0381-06 checks and ratings never claim proof of sound quality', () => {
  it('says machine checks cannot tell how it sounds, and keeps Good and Bad as your own answer', async () => {
    fakeBackend({ 'GET /mix/2/options': options });
    const [previous, item] = repeated(seam('ready', 'abcdef9999', {
      label: 'Blend', style: 'bass_swap_blend', why: 'Basslines swap on the phrase',
      checks: [{ name: 'level', passed: true, text: 'No jump in loudness' }, { name: 'clip', passed: false, text: 'Some clipping' }],
    } as never));
    const { view } = show(item, previous, 'details');
    expect(screen.getByText('Quality checks')).toBeInTheDocument();
    expect(screen.getByText('Measured on the finished audio. These can’t tell you how it sounds. Only you can.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sounds (great|good|perfect)|proven|guaranteed/i);
    view.unmount();
    show(item, previous, 'listen');
    const thumbs = screen.getByRole('group', { name: 'Rate this seam' });
    expect(thumbs).toHaveTextContent('How was it?');
    expect(document.body.textContent).not.toMatch(/proven|guaranteed/i);
  });
});

describe('UF-0381-07 Studio opens for the exact transition', () => {
  it('opens a Studio workspace named for the directed pair it was opened from', async () => {
    const calls = fakeBackend({ 'GET /mix/2/options': options });
    const [previous, item] = repeated();
    show(item, previous, 'studio');
    await userEvent.click(await screen.findByRole('button', { name: 'Open the Studio' }));
    const workspace = await screen.findByRole('dialog', { name: 'Song 2 into Song 1' });
    expect(workspace).toBeInTheDocument();
    // the Studio session is asked for this exact transition position, never the first time the song appeared
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/mix/2/studio')).toBe(true));
    expect(calls.some((call) => call.path === '/mix/0/studio' || call.path === '/mix/1/studio')).toBe(false);
  });
});
