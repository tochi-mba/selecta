import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { messageOf, statusWords, withIdempotencyKey } from './api';
import { overSoftCap } from './Billing';
import { WorkspaceNameOffer } from './WorkspaceNameOffer';

// Product audit: one key per press, refusals in plain words, the soft cap, the workspace rename.

afterEach(() => localStorage.clear());

describe('one Idempotency-Key per press', () => {
  it('adds a key to a write that has none, keeps a caller’s own, and leaves reads alone', () => {
    const write = new Headers(withIdempotencyKey({ method: 'POST' }, true)!.headers);
    expect(write.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    const own = new Headers(withIdempotencyKey({ method: 'PUT', headers: { 'Idempotency-Key': 'mine' } }, true)!.headers);
    expect(own.get('Idempotency-Key')).toBe('mine');
    expect(withIdempotencyKey(undefined, true)).toBeUndefined();
    expect(withIdempotencyKey({ method: 'POST' }, false)).toEqual({ method: 'POST' });
  });
});

describe('refusals in plain words', () => {
  it('never shows a bare code or a status number', () => {
    expect(messageOf({ detail: { code: 'billing_not_permitted' } }, statusWords(403))).toBe('This account can’t do that.');
    expect(statusWords(429)).toMatch(/Wait a moment/);
    expect(statusWords(502)).not.toMatch(/\d/);
  });
});

describe('the library soft cap', () => {
  it('is said only past the cap', () => {
    const account = cloudAccount();
    expect(overSoftCap(account)).toBe(false);
    account.usage = { ...account.usage!, library: { songs: 3_001, soft_cap: 3_000 } };
    expect(overSoftCap(account)).toBe(true);
  });
});

describe('renaming the starting workspace', () => {
  const owner = () => {
    const account = cloudAccount();
    return { ...account, workspace: { ...account.workspace, name: 'Personal', role: 'owner' }, features: { ...account.features, 'account.workspace_name': true } };
  };

  it('is offered once to the owner and sends the new name', async () => {
    const rename = vi.fn(async () => undefined);
    render(<WorkspaceNameOffer account={owner()} rename={rename} />);
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: '  Sam’s music ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename it' }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('Sam’s music'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename it' })).toBeNull());
  });

  it('stays away once dismissed, for a renamed workspace, and with the flag off', () => {
    const { rerender, container } = render(<WorkspaceNameOffer account={owner()} rename={async () => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }));
    rerender(<WorkspaceNameOffer key="again" account={owner()} rename={async () => undefined} />);
    expect(container.textContent).toBe('');
    localStorage.clear();
    rerender(<WorkspaceNameOffer key="renamed" account={{ ...owner(), workspace: { ...owner().workspace, name: 'Studio' } }} rename={async () => undefined} />);
    expect(container.textContent).toBe('');
    rerender(<WorkspaceNameOffer key="off" account={{ ...owner(), features: { 'account.workspace_name': false } }} rename={async () => undefined} />);
    expect(container.textContent).toBe('');
  });
});
