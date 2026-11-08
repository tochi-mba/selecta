import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lucy } from '../lucy/client';
import type { Approval, Commit, Revision } from '../lucy/types';
import { Approve } from './LucyApprove';

const revision = (id: string) => ({ id, hash: 'h'.repeat(64) } as Revision);
const approval = (action: Approval['action'] = 'draft'): Approval => ({
  token: 'token', expires_at: Math.floor(Date.now() / 1000) + 300, action,
  preflight: { ok: true, problems: [], songs: 3, ready: 2, needed: 2, ready_only: true, title: 'Three songs' },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const props = {
  isCurrent: true, blocked: '', seen: {}, onStale: vi.fn(),
  startPlaying: vi.fn(async () => {}),
};

afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

describe('Lucy approval revision identity', () => {
  it('discards a preflight response for the previous revision', async () => {
    const old = deferred<Approval>();
    const ask = vi.spyOn(lucy, 'approve').mockImplementation(({ revision: id }) =>
      id === 'old' ? old.promise : Promise.resolve(approval()));
    const { rerender } = render(<Approve {...props} revision={revision('old')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    rerender(<Approve {...props} revision={revision('new')} />);
    await act(async () => old.resolve(approval()));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Three songs')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(within(await screen.findByRole('dialog')).getByText('Three songs')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith({ revision: 'new', hash: 'h'.repeat(64), action: 'draft' });
  });

  it('does not present or auto-play a late commit from an abandoned revision', async () => {
    const old = deferred<Commit>();
    vi.spyOn(lucy, 'approve').mockResolvedValue(approval('draft_and_play'));
    vi.spyOn(lucy, 'commit').mockReturnValue(old.promise);
    const startPlaying = vi.fn(async () => {});
    const { rerender } = render(<Approve {...props} startPlaying={startPlaying} revision={revision('old')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and play' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and play' }));
    await waitFor(() => expect(lucy.commit).toHaveBeenCalledTimes(1));

    rerender(<Approve {...props} startPlaying={startPlaying} revision={revision('new')} />);
    await act(async () => old.resolve({
      key: 'saved', status: 'committed', draft_id: 4, name: 'Old mix', played: true, repeat: false,
    }));
    expect(screen.queryByText(/Saved as draft/)).toBeNull();
    expect(startPlaying).not.toHaveBeenCalled();
  });
});
