import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LABS_DRAFT_KEY, LocalFirstLabs, type LabsStatus } from './LocalFirstLabs';

afterEach(() => sessionStorage.removeItem(LABS_DRAFT_KEY));

/** BF-0467-05: the Labs card shows only what is true, and opt-out never depends on Labs being open. */
function server(initial: LabsStatus) {
  let status = { ...initial };
  const calls: { path: string; init?: RequestInit }[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.endsWith('/join')) status = { ...status, enrolled: true, on: true, reason: 'rule_on' };
    if (path.endsWith('/leave')) status = { ...status, enrolled: false, on: false, reason: 'rule_off' };
    return (path.endsWith('local-first') ? status : {}) as never;
  });
  return { request: request as unknown as <T>(path: string, init?: RequestInit) => Promise<T>, calls };
}

const OPEN: LabsStatus = { enrolled: false, on: false, reason: 'rule_off', labs_open: true };

describe('LocalFirstLabs', () => {
  it('renders nothing when Labs is closed and the member is not in', async () => {
    const { request, calls } = server({ ...OPEN, labs_open: false });
    const { container } = render(<LocalFirstLabs request={request} />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('joins, tells the member, and refreshes the account', async () => {
    const { request, calls } = server(OPEN);
    const onChanged = vi.fn();
    render(<LocalFirstLabs request={request} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join Labs' }));
    expect(await screen.findByRole('button', { name: 'Leave Labs' })).toBeInTheDocument();
    expect(calls.some((call) => call.path.endsWith('/join') && call.init?.method === 'POST')).toBe(true);
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('You are in. Your account now plays music from your own devices.')).toBeInTheDocument();
  });

  it('sends feedback as the member wrote it', async () => {
    const { request, calls } = server({ ...OPEN, enrolled: true, on: true });
    render(<LocalFirstLabs request={request} />);
    fireEvent.change(await screen.findByLabelText('Tell us what you noticed'), { target: { value: ' Fast library ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/feedback'))).toBe(true));
    const sent = calls.find((call) => call.path.endsWith('/feedback'));
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ text: 'Fast library' });
    expect(await screen.findByText(/SelectaDJ team reads every note/)).toBeInTheDocument();
  });

  it('still offers leaving after Labs closes, and says when the experience is paused', async () => {
    const { request } = server({ enrolled: true, on: false, reason: 'rule_off', labs_open: false });
    render(<LocalFirstLabs request={request} />);
    expect(await screen.findByRole('button', { name: 'Leave Labs' })).toBeInTheDocument();
    expect(screen.getByText(/paused for your account/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tell us what you noticed')).toBeNull();
  });

  it('asks before leaving, and focus lands on the button that replaces Leave', async () => {
    const { request, calls } = server({ ...OPEN, enrolled: true, on: true });
    render(<LocalFirstLabs request={request} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Leave Labs' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Leave Labs?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay in Labs' }));
    expect(calls.some((call) => call.path.endsWith('/leave'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Leave Labs' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, leave Labs' }));
    const join = await screen.findByRole('button', { name: 'Join Labs' });
    await waitFor(() => expect(document.activeElement).toBe(join));
    expect(screen.getByRole('status')).toHaveTextContent('You have left.');
  });

  it('says a failure as an alert, apart from good news, and keeps the draft for next time', async () => {
    let fail = true;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/feedback') && fail) throw new Error('The note service is busy.');
      return (path.endsWith('local-first') ? { ...OPEN, enrolled: true, on: true } : {}) as never;
    }) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;
    const view = render(<LocalFirstLabs request={request} />);
    fireEvent.change(await screen.findByLabelText('Tell us what you noticed'), { target: { value: 'Loud seams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your note did not send.');
    expect(screen.queryByRole('status')).toBeNull();
    view.unmount();
    render(<LocalFirstLabs request={request} />);
    expect(await screen.findByLabelText('Tell us what you noticed')).toHaveValue('Loud seams');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sessionStorage.getItem(LABS_DRAFT_KEY)).toBeNull();
  });
});
