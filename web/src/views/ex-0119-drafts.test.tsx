import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { fakeBackend } from '../test/backend';
import { Drafts } from './Drafts';

// EX-0119-02: finding and ordering drafts stays part of the complete draft control set,
// alongside play, edit, rename, copy, prioritize and delete (covered in Drafts.test.tsx).

const draft = (id: number, name: string, ready: number): DraftInfo => ({
  id, name, songs: 4, seconds: 800, seams: 3, ready, failed: 0, waiting: 3 - ready, rendering: false,
  place: null, eta: null, to_render: 300, missing: 0,
});
const list = (drafts: DraftInfo[]): DraftList => ({
  drafts, current: { name: 'Current', songs: 10, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false,
});

const edits = () => screen.getAllByRole('button', { name: /^Edit / }).map((button) => button.getAttribute('aria-label') ?? button.textContent);

describe('EX-0119-02 finding and sorting drafts', () => {
  it('searches by name and sorts by name or readiness without losing any draft', async () => {
    fakeBackend({
      'GET /drafts': list([
        draft(5, 'Sunday', 0), draft(4, 'alpha', 3), draft(3, 'Friday', 1), draft(2, 'Beach', 2), draft(1, 'Late night', 0),
      ]),
    });
    render(<Drafts notify={vi.fn()} openDraft={vi.fn()} playDraft={vi.fn(async () => {})} setView={vi.fn()} />);
    await screen.findByRole('button', { name: 'Edit Sunday' });
    const tools = within(screen.getByText('Find a draft').closest('.draft-tools') as HTMLElement);

    fireEvent.change(tools.getByRole('searchbox'), { target: { value: 'day' } });
    expect(edits()).toEqual(['Edit Sunday', 'Edit Friday']);
    fireEvent.change(tools.getByRole('searchbox'), { target: { value: '' } });

    fireEvent.change(tools.getByRole('combobox'), { target: { value: 'name' } });
    expect(edits()).toEqual(['Edit alpha', 'Edit Beach', 'Edit Friday', 'Edit Late night', 'Edit Sunday']);
    fireEvent.change(tools.getByRole('combobox'), { target: { value: 'readiness' } });
    expect(edits()[0]).toBe('Edit alpha');
    expect(edits()).toHaveLength(5);
  });
});
