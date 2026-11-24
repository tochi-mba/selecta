import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { COMPACT, NARROWER } from './editorLayout';
import { Mix } from './Mix';

/** editor.phone_layout: on a phone the editor is a list of songs and the transitions between them.
 * An opened song or transition rises in a sheet that Escape and Back close; every move a drag can
 * make is also in each song's menu; and with the flag off the editor is exactly as it was. */

function Harness({ start, notify = () => {}, live = false }: { start: MixItem[]; notify?: (message: string, undo?: unknown) => void; live?: boolean }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo refreshMix={() => {}} analysisAvailable={!live}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={notify as never} stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend' });
const start = songs(ready('a'), ready('b'), ready('c'));
const moved = (from: number, to: number): MixData => {
  const order = [...start];
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return { mix: order.map((song, position) => ({ ...song, position, seam: position === 0 ? null : song.seam ?? ready(`n${position}`) })), name: 'Test mix', can_undo: true } as unknown as MixData;
};
const titles = () => [...document.querySelectorAll('.pe-story .pe-song h3')].map((h) => h.textContent?.replace(/^\d+\.\s*/, ''));
const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === COMPACT || query === NARROWER, addEventListener: () => {}, removeEventListener: () => {} }));

beforeEach(() => phone());
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => setFlags(null));
});

describe('the editor on a phone (editor.phone_layout)', () => {
  it('reads as the mix: each song a heading in an ordered list, each transition a button naming both songs', () => {
    fakeBackend({});
    render(<Harness start={start} />);
    expect(document.querySelector('[data-editor-layout="sheet"]')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['1. Song 1', '2. Song 2', '3. Song 3', '4. Song 4']);
    expect(screen.getByRole('button', { name: /Transition from Song 1 into Song 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reorder Song 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mix actions' })).toBeTruthy();
    // the rows are compact: no Play, Move up or Move down repeated on every row
    expect(screen.queryByRole('button', { name: 'Move Song 2 up' })).toBeNull();
  });

  it('moves a song to the top from its menu, without dragging', async () => {
    const calls = fakeBackend({ 'POST /mix/move': moved(2, 0) });
    render(<Harness start={start} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 3' }));
    const sheet = await screen.findByRole('dialog', { name: 'Song 3' });
    expect(within(sheet).getByRole('button', { name: /Move up/ })).toBeTruthy();
    await userEvent.click(within(sheet).getByRole('button', { name: /Move to the top/ }));
    await waitFor(() => expect(titles()).toEqual(['Song 3', 'Song 1', 'Song 2', 'Song 4']));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ source: 2, target: 0 });
  });

  it('the handle moves a song with the arrow keys', async () => {
    const calls = fakeBackend({ 'POST /mix/move': moved(1, 2) });
    render(<Harness start={start} />);
    screen.getByRole('button', { name: 'Reorder Song 2' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 3', 'Song 2', 'Song 4']));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ source: 1, target: 2 });
  });

  it('a refused move says why and keeps the mix as saved; a failed one offers Try again', async () => {
    fakeBackend({ 'POST /mix/move': new Reply(409, { detail: 'The mix changed under this press, so nothing happened.', code: 'mix_changed' }) });
    render(<Harness start={start} />);
    screen.getByRole('button', { name: 'Reorder Song 2' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/nothing happened/);
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Not saved')).toBeNull();
  });

  it('a transition opens in a sheet that grows, and closes on Escape with focus back on the transition', async () => {
    fakeBackend({ 'GET /mix/2/options': { moves: [], exits: [], entries: [], links: [], keys: [], tempo_gap: 0 } });
    render(<Harness start={start} />);
    const connector = screen.getByRole('button', { name: /Transition from Song 1 into Song 2/ });
    await userEvent.click(connector);
    const sheet = await screen.findByRole('dialog', { name: 'Into Song 2' });
    expect(sheet.closest('.pe-sheet')?.classList.contains('is-half')).toBe(true);
    await userEvent.click(within(sheet.closest('.overlay')! as HTMLElement).getByRole('button', { name: 'Make the sheet taller' }));
    expect(sheet.closest('.pe-sheet')?.classList.contains('is-full')).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Into Song 2' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Transition from Song 1 into Song 2/ })));
  });

  it('Back closes the sheet and stays in the editor', async () => {
    fakeBackend({});
    render(<Harness start={start} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    await screen.findByRole('dialog', { name: 'Song 2' });
    act(() => {
      window.history.replaceState({}, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Song 2' })).toBeNull());
    expect(document.querySelector('[data-editor-layout="sheet"]')).not.toBeNull();
  });

  it('a browser mix opens its transition with the moves as choices and Hear it', async () => {
    act(() => setFlags({ seam_inspector: false, 'cloud.browser_moves': true }));
    const picked = () => ({ settings: { move: 'auto' }, state: { status: 'none' as const, key: '' } });
    const live = songs(picked(), picked());
    const calls = fakeBackend({ 'POST /mix/1/seam': { ok: true } });
    render(<Harness start={live} live />);
    expect(screen.getAllByText('SelectaDJ picks as it plays').length).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: /Transition from Song 1 into Song 2/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Into Song 2' });
    expect(within(sheet).getByRole('button', { name: /Hear it/ })).toBeTruthy();
    const choices = within(sheet).getByRole('group', { name: /How it moves into Song 2/ });
    const first = within(choices).getAllByRole('button')[0];
    fireEvent.click(within(choices).getAllByRole('button').find((button) => button !== first && !button.hasAttribute('disabled'))!);
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/mix/1/seam'))).toBe(true));
  });

  it('with the flag off the editor is exactly as it was', () => {
    act(() => setFlags({ 'editor.phone_layout': false }));
    fakeBackend({});
    render(<Harness start={start} />);
    expect(document.querySelector('[data-editor-layout]')).toBeNull();
    expect(document.querySelectorAll('li.song[data-song-key]').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Move Song 2 up' })).toBeTruthy();
  });
});
