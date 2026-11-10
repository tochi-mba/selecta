import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { fakeBackend } from '../test/backend';
import { Drafts } from './Drafts';

/** UF-0379-01/02/07/08: same-name drafts keep exact identities in every action, commands keep a safe
 * order, long names keep their actions, and an empty My Mixes offers one direct way to start. */

const draft = (id: number, more: Partial<DraftInfo> = {}): DraftInfo => ({
  id, name: `Draft ${id}`, songs: 4, seconds: 800, seams: 3, ready: 1, failed: 0, waiting: 2,
  rendering: false, place: null, eta: null, to_render: 300, missing: 0, ...more,
});
const list = (drafts: DraftInfo[]): DraftList => ({
  drafts, current: { name: 'Current', songs: 10, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false,
});
function show(answer: DraftList, routes: Record<string, unknown> = {}) {
  const calls = fakeBackend({ 'GET /drafts': answer, ...routes });
  const props = { notify: vi.fn(), openDraft: vi.fn(), playDraft: vi.fn(async () => {}), setView: vi.fn() };
  render(<Drafts {...props} />);
  return { calls, ...props };
}
afterEach(() => vi.unstubAllGlobals());

describe('UF-0379-01/07 drafts that share a name', () => {
  it('names each by its exact draft number, so Edit, Play and Delete reach the intended one', async () => {
    const { openDraft, playDraft } = show(list([draft(3, { name: 'Party' }), draft(7, { name: 'Party' }), draft(9, { name: 'Solo' })]));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Party (draft 7)' }));
    expect(openDraft).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: 'Play Party (draft 3)' }));
    await waitFor(() => expect(playDraft).toHaveBeenCalledWith(3));
    expect(screen.getByText('Draft 3')).toBeInTheDocument();
    expect(screen.getByText('Draft 7')).toBeInTheDocument();
    // a unique name stays plain
    expect(screen.getByRole('button', { name: 'Edit Solo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Party (draft 7)' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Party (draft 7)' }));
    expect(screen.getByRole('dialog', { name: 'Delete Party?' })).toHaveTextContent('Your current mix and original music files are untouched');
  });

  it('keeps every action for a very long name in a long list', async () => {
    const long = 'A very long draft name for the late summer warehouse set'.slice(0, 60);
    show(list(Array.from({ length: 30 }, (_, index) => draft(index + 1, { name: index === 0 ? long : `Draft ${index + 1}` }))));
    const row = (await screen.findByRole('button', { name: `Edit ${long}` })).closest('li') as HTMLElement;
    expect(within(row).getByRole('button', { name: `Play ${long}` })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: `More actions for ${long}` })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(30);
  });
});

describe('UF-0379-02 draft commands keep a safe order', () => {
  it('puts Edit first, then Play, with Copy, Prioritize and Delete in the row’s own menu', async () => {
    show(list([draft(1)]));
    const row = (await screen.findByRole('button', { name: 'Edit Draft 1' })).closest('li') as HTMLElement;
    const actions = row.querySelector('.draft-actions') as HTMLElement;
    const buttons = within(actions).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons.slice(0, 2)).toEqual(['Edit Draft 1', 'Play Draft 1']);
    expect(within(actions).getByRole('button', { name: 'Edit Draft 1' })).toHaveClass('primary');
    fireEvent.click(within(actions).getByRole('button', { name: 'More actions for Draft 1' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'));
    expect(items).toEqual(['Rename Draft 1', 'Copy Draft 1', 'Prioritize Draft 1', 'Delete Draft 1']);
  });
});

describe('UF-0379-08 an empty My Mixes', () => {
  it('offers one direct way to start a draft, which opens it', async () => {
    const { calls, openDraft } = show(list([]), { 'POST /drafts': { id: 4, name: 'Draft 1' } });
    const empty = (await screen.findByRole('heading', { name: 'A place for your next mix' })).closest('.empty-state') as HTMLElement;
    fireEvent.click(within(empty).getByRole('button', { name: 'Start your first draft' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalledWith(4));
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/drafts']);
  });
});
