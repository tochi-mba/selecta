import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeamOptions } from '../api';
import { seam, songs } from '../test/backend';
import { SeamInspector } from './SeamInspector';

const options = {
  moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }],
  exits: [{ bar: 32, time: 64, kind: 'phrase' }, { bar: 48, time: 96, kind: 'drop' }],
  entries: [{ bar: 8, time: 16, kind: 'phrase' }, { bar: 16, time: 32, kind: 'phrase' }],
  lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
} as unknown as SeamOptions;

const calls: { method: string; url: string; headers: Headers; body: unknown }[] = [];
function backend() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(init.body as string) : null });
    if (url.includes('/options')) return new Response(JSON.stringify(options), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

const writes = () => calls.filter((call) => call.method === 'POST' && call.url.endsWith('/seam'));

// SF-0221-05: cues are always times (m:ss) with their musical kind, lengths are always bars, and every
// edit, made from the keyboard, lands on this one transition, guarded by the mix it was made on.
describe('SF-0221-05 exact cue and length', () => {
  it('shows cue choices and their range in one unit, and length in bars', async () => {
    backend();
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(<SeamInspector item={item} previous={previous} names={{ bass_swap_blend: 'Blend' }} refreshMix={() => {}} notify={() => {}}
      guard={{ 'x-mix-order': '1,2' }} tab="change" setTab={() => {}} autoPlay={false} onClose={() => {}} />);
    const leave = await screen.findByLabelText(/Leave .* at/);
    const clock = /^\d+:\d{2}, \w+$/;
    for (const box of [leave, screen.getByLabelText(/Bring in .* at/)]) {
      const named = within(box).getAllByRole('option').slice(1).map((option) => option.textContent ?? '');
      expect(named.every((words) => clock.test(words))).toBe(true);
    }
    expect(screen.getByText('Possible from 1:04 to 1:36.')).toBeInTheDocument();
    expect(screen.getByText('Possible from 0:16 to 0:32.')).toBeInTheDocument();
    const lengths = within(screen.getByRole('group', { name: 'How long they overlap' })).getAllByRole('button').map((button) => button.textContent);
    expect(lengths).toEqual(['Pick for me', '4 bars', '8 bars', '16 bars']);
  });

  it('keyboard edits send exact bar values, for this transition only, guarded by the mix order', async () => {
    backend();
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(<SeamInspector item={item} previous={previous} names={{ bass_swap_blend: 'Blend' }} refreshMix={() => {}} notify={() => {}}
      guard={{ 'x-mix-order': '1,2' }} tab="change" setTab={() => {}} autoPlay={false} onClose={() => {}} />);
    const leave = await screen.findByLabelText(/Leave .* at/);
    leave.focus();
    expect(leave).toHaveFocus();
    // a select changes with the arrow keys; the change it fires is what the page acts on
    fireEvent.keyDown(leave, { key: 'ArrowDown' });
    fireEvent.change(leave, { target: { value: '48' } });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].url).toBe('/api/mix/1/seam');
    expect(writes()[0].body).toMatchObject({ exit_bar: 48, soft: false });
    expect(writes()[0].headers.get('x-mix-order')).toBe('1,2');
    const eight = screen.getByRole('button', { name: '8 bars' });
    eight.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(writes()).toHaveLength(2));
    // the newer edit keeps the earlier cue: one transition's settings, edited together
    expect(writes()[1].body).toMatchObject({ exit_bar: 48, bars: 8, soft: false });
    expect(writes()[1].url).toBe('/api/mix/1/seam');
    expect(calls.every((call) => !/\/mix\/(0|2|3)\//.test(call.url))).toBe(true);
    // a cue that isn't offered can't be sent: the range is the offered set
    expect(within(leave).queryByRole('option', { name: /2:00/ })).toBeNull();
  });
});
