import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, status } from '../test/backend';
import { FoldersPanel, relinkReferenceWords } from './WorkshopPanels';

/** GP-0252-03 and -04: finding a moved folder shows what refers to its songs, and a changed recording
 * only moves when you tick it as the same recording, for that exact song. */

const folders = { folders: [{ path: 'D:/Music/old', available: false, songs: 2 }], watch_every: 60 };
const references = { current_mix: 1, drafts: 2, ratings: 3, corrections: 0, discoveries: 0 };
const changed = {
  from: 'D:/Music/old', to: 'E:/Music', total: 2, verified: 1, blocked: 1, token: null, confirmed: 0, needs_confirmation: 1, references,
  candidates: [
    { id: 9, title: 'Second', artist: 'Other', status: 'verified' },
    { id: 7, title: 'Café del Mar', artist: 'Someone', status: 'identity_not_verified', why: 'its title now reads “A cover version”', can_confirm: true },
  ],
};
const answered = {
  ...changed, verified: 2, blocked: 0, token: 'f'.repeat(64), confirmed: 1, needs_confirmation: 0,
  candidates: [changed.candidates[0], { ...changed.candidates[1], status: 'confirmed_by_you' }],
};

describe('GP-0252-03 the preview says what refers to the songs it moves', () => {
  it('names each kind of reference with its count, and that it all keeps working', () => {
    expect(relinkReferenceWords(references)).toBe(
      'Kept as they are: 1 song in your current mix, 2 drafts use them, 3 ratings. Song IDs don’t change, so all of it keeps working.',
    );
    expect(relinkReferenceWords({ current_mix: 0, drafts: 0, ratings: 0, corrections: 0, discoveries: 0 }))
      .toBe('Nothing else refers to these songs yet.');
  });
});

describe('GP-0252-04 a changed recording needs your yes, song by song', () => {
  it('asks about the changed song, sends exactly that answer, and only then offers to confirm', async () => {
    const previews = [changed, answered];
    const calls = fakeBackend({
      'GET /folders': folders,
      'POST /folders/relink/preview': () => previews.shift(),
      'POST /folders/relink': { moved: 2, folder: 'E:/Music', status: 'relinked' },
    });
    render(<FoldersPanel status={status()} refreshStatus={() => {}} notify={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Find moved folder' }));
    const dialog = screen.getByRole('dialog', { name: 'Re-link a moved music folder' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'E:/Music' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview without changing anything' }));

    expect(await within(dialog).findByText(/Kept as they are: 1 song in your current mix/)).toBeInTheDocument();
    const same = within(dialog).getByRole('checkbox', { name: /Same recording: Café del Mar \(ID 7\)/ });
    expect(same).not.toBeChecked();
    expect(within(dialog).queryByRole('button', { name: /^Confirm/ })).toBeNull();

    await userEvent.click(same);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview again with these answers' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Confirm 2 verified songs/ })).toBeInTheDocument());
    const asked = calls.filter((call) => call.path === '/folders/relink/preview');
    expect((asked[0].body as { confirmed: number[] }).confirmed).toEqual([]);
    expect((asked[1].body as { confirmed: number[] }).confirmed).toEqual([7]);

    await userEvent.click(within(dialog).getByRole('button', { name: /^Confirm 2 verified songs/ }));
    await waitFor(() => expect(calls.some((call) => call.path === '/folders/relink')).toBe(true));
    const committed = calls.find((call) => call.path === '/folders/relink')!;
    expect(committed.body).toMatchObject({ token: 'f'.repeat(64), confirmed: [7] });
  });
});
