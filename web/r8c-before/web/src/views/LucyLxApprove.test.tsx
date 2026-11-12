import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lucy } from '../lucy/client';
import type { Approval, Revision } from '../lucy/types';
import { Approve } from './LucyApprove';

/* LX-0362-01: Save as draft and Save and play say what each does, and both are equally reachable. */
const props = { isCurrent: true, blocked: '', seen: {}, onStale: vi.fn(), startPlaying: vi.fn(async () => {}) };
const approval = (action: Approval['action']): Approval => ({
  token: 'token', expires_at: Math.floor(Date.now() / 1000) + 300, action,
  preflight: { ok: true, problems: [], songs: 3, ready: 2, needed: 2, ready_only: false, title: 'Three songs' },
});

afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

describe('LX-0362-01 two approval actions with different consequences', () => {
  it('both are plain enabled buttons in the tab order, and the page says what each one does', async () => {
    render(<Approve {...props} revision={{ id: 'rev', hash: 'h'.repeat(64) } as Revision} />);
    const draft = screen.getByRole('button', { name: 'Save as draft' });
    const play = screen.getByRole('button', { name: 'Save and play' });
    for (const button of [draft, play]) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toBeEnabled();
      expect(button.getAttribute('tabindex')).not.toBe('-1');
    }
    expect(screen.getByText('Saving makes a draft from exactly these songs. Save and play also replaces what’s playing, after you confirm.')).toBeInTheDocument();
    await userEvent.tab();
    expect(draft).toHaveFocus();
    await userEvent.tab();
    expect(play).toHaveFocus();
  });

  it('each confirmation names its own consequence: only Save and play mentions replacing what plays', async () => {
    const spy = vi.spyOn(lucy, 'approve');
    spy.mockResolvedValueOnce(approval('draft'));
    render(<Approve {...props} revision={{ id: 'rev', hash: 'h'.repeat(64) } as Revision} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    let dialog = await screen.findByRole('dialog', { name: 'Save this mix as a draft?' });
    expect(dialog.textContent).not.toMatch(/replaces what.s playing/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    spy.mockResolvedValueOnce(approval('draft_and_play'));
    await userEvent.click(screen.getByRole('button', { name: 'Save and play' }));
    dialog = await screen.findByRole('dialog', { name: 'Save this mix and play it?' });
    expect(dialog.textContent).toMatch(/replaces what.s playing/i);
  });
});
