// The Lucy allowance actions and the usage report against a fake admin API: each change asks for
// a reason and the email typed, sends one request, shows the server's refusal in its words, and
// is disabled with the reason for a role without the permission or in view mode.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminError, AdminFetch, Me } from './adminApi';
import { factorMilli, LucyAllowance, LucyUsageReport } from './LucyUsage';
import { ConsoleContext, DangerDialog, DangerRequest } from './safety';

type Call = { path: string; method?: string; body: Record<string, unknown>; key: string | null };
const EMAIL = 'listener@example.test';
const ME = { user_id: 'me', roles: [], permissions: [], session: { id: 's', expires_at: 0 }, role_matrix: { billing: { title: 'Billing', permissions: ['billing.overrides.create'] } } } as Me;

let calls: Call[] = [];
let respond: (call: Call) => Promise<unknown>;
let clock = 0;
const api = (async (path: string, init: RequestInit = {}) => {
  const call = { path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : {}, key: new Headers(init.headers).get('Idempotency-Key') };
  calls.push(call);
  return respond(call);
}) as AdminFetch;

/** Past the half second in which a button that has just appeared ignores a press. */
const settle = () => { clock += 600; };

function Console({ children, allowed = true, viewing = false }: { children: ReactNode; allowed?: boolean; viewing?: boolean }) {
  const [danger, setDanger] = useState<DangerRequest | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  const ctx = {
    api, me: ME, can: () => allowed, changesUntil: viewing ? null : 4_000_000_000, makeChanges: async () => undefined, stopChanges: async () => undefined,
    needs: () => 'Needs the Billing role', spec: () => undefined, toast: (toast: { text: string }) => setSaid((all) => [...all, toast.text]), ask: setDanger,
  };
  return (
    <ConsoleContext.Provider value={ctx}>
      {children}
      {danger && <DangerDialog request={danger} environment="development" onClose={() => setDanger(null)} />}
      <ul aria-label="Toasts">{said.map((text) => <li key={text}>{text}</li>)}</ul>
    </ConsoleContext.Provider>
  );
}

async function openDialog(button: string) {
  settle();
  await userEvent.click(screen.getByRole('button', { name: button }));
  return within(await screen.findByRole('alertdialog'));
}

async function fill(dialog: ReturnType<typeof within>, reason = 'A customer asked for more') {
  await userEvent.type(dialog.getByLabelText(/Reason/), reason);
  await userEvent.type(dialog.getByLabelText(`Type ${EMAIL} to confirm`), EMAIL);
  settle();
}

beforeEach(() => {
  calls = []; clock = 1_000_000; respond = async () => ({});
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

describe('the Lucy allowance actions', () => {
  it('sets a factor in thousandths with the reason, once, and says what happened', async () => {
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    await userEvent.type(screen.getByLabelText(/Factor/), '1.5');
    const dialog = await openDialog('Set factor…');
    expect(dialog.getByText(/becomes 1.5 times its plan’s allowance/)).toBeInTheDocument();
    await fill(dialog);
    await userEvent.click(dialog.getByRole('button', { name: 'Set the factor to 1.5' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/admin/ai/workspaces/w1/multiplier', method: 'PUT', body: { multiplier_milli: 1500, reason: 'A customer asked for more' } });
    expect(calls[0].key).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL}’s Lucy allowance is now 1.5 times the plan’s.`);
  });

  it('refuses a factor outside the server’s range before asking anything', async () => {
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    await userEvent.type(screen.getByLabelText(/Factor/), '100.5');
    settle();
    await userEvent.click(screen.getByRole('button', { name: 'Set factor…' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type a number from 0 to 100');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls).toHaveLength(0);
    expect([factorMilli('0'), factorMilli('100'), factorMilli(' 2.125 '), factorMilli('0.001')]).toEqual([0, 100_000, 2125, 1]);
    expect([factorMilli(''), factorMilli('-1'), factorMilli('100.001'), factorMilli('1.2345'), factorMilli('1e2'), factorMilli('two')]).toEqual([null, null, null, null, null, null]);
  });

  it('switches Lucy off with 0 and back on by clearing the factor', async () => {
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    let dialog = await openDialog('Switch Lucy off…');
    await fill(dialog, 'Abuse report confirmed');
    await userEvent.click(dialog.getByRole('button', { name: `Switch Lucy off for ${EMAIL}` }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`Lucy is off for ${EMAIL}.`));
    dialog = await openDialog('Back to the plan’s allowance…');
    await fill(dialog, 'Back to the plan');
    await userEvent.click(dialog.getByRole('button', { name: 'Back to the plan’s allowance' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([{ multiplier_milli: 0, reason: 'Abuse report confirmed' }, { multiplier_milli: null, reason: 'Back to the plan' }]);
  });

  it('switches over now and cancels, saying when there was nothing to cancel', async () => {
    respond = async (call) => ({ when: call.body.when, changed: false });
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    let dialog = await openDialog('Switch over now…');
    await fill(dialog, 'Testing the new allowance');
    await userEvent.click(dialog.getByRole('button', { name: 'Switch over now' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL} is switched over.`));
    dialog = await openDialog('Cancel the switch…');
    await fill(dialog, 'It misbehaved');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel the switch' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${EMAIL} had no switch to cancel.`));
    expect(calls.map((c) => [c.path, c.method, c.body])).toEqual([
      ['/admin/ai/workspaces/w1/cutover', 'PUT', { when: 'now', reason: 'Testing the new allowance' }],
      ['/admin/ai/workspaces/w1/cutover', 'PUT', { when: 'cancel', reason: 'It misbehaved' }],
    ]);
  });

  it('needs a reason and the email typed before it sends anything', async () => {
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    const dialog = await openDialog('Switch over now…');
    const go = dialog.getByRole('button', { name: 'Switch over now' });
    await userEvent.type(dialog.getByLabelText(`Type ${EMAIL} to confirm`), EMAIL);
    expect(go).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/Reason/), '   ');
    expect(go).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/Reason/), 'Testing');
    expect(go).toBeEnabled();
    expect(calls).toHaveLength(0);
  });

  it('shows the server’s refusal in its own words and keeps the dialog open', async () => {
    respond = async () => { throw new AdminError('Staff can’t do this to their own account or workspace, or approve their own action.', 403, 'self_approval'); };
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    const dialog = await openDialog('Switch Lucy off…');
    await fill(dialog);
    await userEvent.click(dialog.getByRole('button', { name: `Switch Lucy off for ${EMAIL}` }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Staff can’t do this to their own account or workspace');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('list', { name: 'Toasts' })).toBeEmptyDOMElement();
  });

  it('says Working and takes no second press while the request is out', async () => {
    let finish: (value: unknown) => void = () => undefined;
    respond = () => new Promise((resolve) => { finish = resolve; });
    render(<Console><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    const dialog = await openDialog('Switch over now…');
    await fill(dialog);
    await userEvent.click(dialog.getByRole('button', { name: 'Switch over now' }));
    const working = await dialog.findByRole('button', { name: 'Working…' });
    expect(working).toBeDisabled();
    await userEvent.click(working);
    expect(calls).toHaveLength(1);
    finish({ changed: true });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls).toHaveLength(1);
  });

  it('keeps every action disabled, saying which role is needed, without the permission', () => {
    render(<Console allowed={false}><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    for (const name of ['Set factor…', 'Switch Lucy off…', 'Back to the plan’s allowance…', 'Switch over now…', 'Cancel the switch…']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getAllByText('Needs the Billing role')).toHaveLength(5);
  });

  it('keeps every action disabled in view mode, and offers none without a workspace', () => {
    const { unmount } = render(<Console viewing><LucyAllowance workspaceId="w1" email={EMAIL} /></Console>);
    expect(screen.getByRole('button', { name: 'Switch Lucy off…' })).toBeDisabled();
    expect(screen.getAllByText('Press Make changes first')).toHaveLength(5);
    unmount();
    render(<Console><LucyAllowance workspaceId={null} email={EMAIL} /></Console>);
    expect(screen.getByText('No workspace yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the Lucy usage report', () => {
  const spread = (p50: number | null, count = 0) => ({ count, mean: p50, p50, p90: p50, p99: p50 });

  it('lists each plan with its numbers and says when there is not enough data', async () => {
    respond = async () => ({ report: { since: 1_700_000_000, until: 1_702_419_200, catalogue_version: 3, plans: {
      free: { status: 'insufficient_data', cost_per_turn_usd: spread(null), turns_per_session: spread(null), sessions_per_active_week: spread(null), weekly_account_cost_usd: spread(null),
        accounts_reaching_session_share: null, accounts_reaching_week_share: null, platform_cost_usd: 0 },
      premium: { status: 'measured', cost_per_turn_usd: spread(0.0123, 420), turns_per_session: spread(6, 40), sessions_per_active_week: spread(3, 12), weekly_account_cost_usd: spread(1.5, 12),
        accounts_reaching_session_share: 0.25, accounts_reaching_week_share: 0, platform_cost_usd: 5.166 },
    } } });
    render(<LucyUsageReport api={api} />);
    const premium = within((await screen.findByText('Premium')).closest('tr')!);
    for (const text of ['Measured', '420', '0.0123', '6', '3', '1.50', '25%', '0%', '5.17']) expect(premium.getByText(text)).toBeInTheDocument();
    const free = within(screen.getByText('Free').closest('tr')!);
    expect(free.getByText('Insufficient data')).toBeInTheDocument();
    expect(free.getAllByText('n/a')).toHaveLength(6);
    expect(calls[0]).toMatchObject({ path: '/admin/economics/lucy-usage' });
    expect(screen.getByText(/against catalogue version 3/)).toBeInTheDocument();
  });

  it('shows a refusal in the server’s words', async () => {
    respond = async () => { throw new AdminError('Your role does not allow this.', 403, 'forbidden'); };
    render(<LucyUsageReport api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role does not allow this.');
  });
});
