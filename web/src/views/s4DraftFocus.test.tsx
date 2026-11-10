import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { fakeBackend } from '../test/backend';
import { Drafts } from './Drafts';

/**
 * S4-0099-08: renaming, deleting and reordering a draft on My Mixes keep the keyboard on the draft
 * it was acting on, or its nearest neighbour, and never redirect focus to a different card.
 */
const draft = (id: number, more: Partial<DraftInfo> = {}): DraftInfo => ({
  id, name: `Draft ${id}`, songs: 4, seconds: 800, seams: 3, ready: 1, failed: 0, waiting: 2, rendering: false,
  place: null, eta: null, to_render: 300, missing: 0, ...more,
});
const list = (drafts: DraftInfo[]): DraftList => ({
  drafts, current: { name: 'Current', songs: 10, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false,
});

function show(answer: DraftList | (() => DraftList), routes: Record<string, unknown> = {}) {
  const calls = fakeBackend({ 'GET /drafts': answer, ...routes });
  render(<Drafts notify={vi.fn()} openDraft={vi.fn()} playDraft={vi.fn(async () => {})} setView={vi.fn()} />);
  return calls;
}

async function fromMenu(name: string, item: string) {
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

const focusedDraft = () => (document.activeElement as HTMLElement | null)?.id;

describe('S4-0099-08 focus stays with the draft being changed', () => {
  it('after a rename, focus returns to that same draft, not the first card', async () => {
    let named = false;
    show(() => list([draft(1), draft(2, { name: named ? 'Friday' : 'Draft 2' }), draft(3)]), {
      'POST /drafts/2/name': () => { named = true; return { id: 2, name: 'Friday' }; },
    });
    await fromMenu('Draft 2', 'Rename Draft 2');
    const input = screen.getByRole('textbox', { name: 'Name this draft' });
    fireEvent.change(input, { target: { value: 'Friday' } });
    fireEvent.submit(input);
    await waitFor(() => expect(focusedDraft()).toBe('draft-2'));
  });

  it('cancelling a rename also returns focus to that draft', async () => {
    show(list([draft(1), draft(2), draft(3)]));
    await fromMenu('Draft 3', 'Rename Draft 3');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name this draft' }), { key: 'Escape' });
    await waitFor(() => expect(focusedDraft()).toBe('draft-3'));
  });

  it('after a delete, focus moves to the neighbouring draft, not the top of the page', async () => {
    show(list([draft(3), draft(2), draft(1)]), { 'DELETE /drafts/2': { name: 'Draft 2' } });
    await fromMenu('Draft 2', 'Delete Draft 2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Draft 2' })).toBeNull());
    await waitFor(() => expect(['draft-1', 'draft-3']).toContain(focusedDraft()));
  });

  it('after moving a draft to the front of the render line, focus stays on that draft’s controls', async () => {
    const before = list([
      draft(1, { place: 1, eta: { seconds: 100, low: 80, high: 120 } }),
      draft(2, { place: 2, eta: { seconds: 200, low: 160, high: 240 } }),
    ]);
    const after = list([
      draft(1, { place: 2, eta: { seconds: 200, low: 160, high: 240 } }),
      draft(2, { place: 1, eta: { seconds: 100, low: 80, high: 120 } }),
    ]);
    show(before, { 'POST /drafts/2/line/move': after });
    const up = await screen.findByRole('button', { name: 'Move Draft 2 up the line' });
    up.focus();
    fireEvent.click(up);
    // Draft 2 is now first, so its Up button is disabled; the keyboard lands on its Down button
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Draft 2 up the line' })).toBeDisabled());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Draft 2 down the line' })));
  });
});
