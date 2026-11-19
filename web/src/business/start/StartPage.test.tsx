import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StartPage, { START_COPY } from './StartPage';

// /business/start (ADR-0453 BZ-0453-04): with sign-up off it is the pilot contact form and never
// creates an organisation; with sign-up on it names one and opens its setup.

describe('StartPage', () => {
  it('with sign-up off, sends pilot interest and creates nothing', async () => {
    const api = vi.fn(async () => ({ sent: true }));
    render(<StartPage api={api as never} signups={false} onOpen={vi.fn()} />);
    expect(screen.getByText(START_COPY.pilotLead)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: 'Harbour Cafe' } });
    fireEvent.change(screen.getByLabelText(/How many venues/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: START_COPY.send }));
    expect(await screen.findByText(START_COPY.sent)).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
    const [path, init] = api.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/business/pilot-interest');
    expect(JSON.parse(init.body as string)).toMatchObject({ business_name: 'Harbour Cafe', venues: 3 });
  });

  it('says why when the message cannot be sent', async () => {
    const api = vi.fn(async () => { throw new Error("We can't send this from here right now."); });
    render(<StartPage api={api as never} signups={false} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: 'Harbour Cafe' } });
    fireEvent.click(screen.getByRole('button', { name: START_COPY.send }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We can't send this from here right now.");
  });

  it('with sign-up on, creates the organisation and opens its setup', async () => {
    const api = vi.fn(async () => ({ org: { id: 'org-9' } }));
    const onOpen = vi.fn();
    render(<StartPage api={api as never} signups onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: 'Harbour Cafe' } });
    fireEvent.click(screen.getByRole('button', { name: START_COPY.create }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/b/org-9/setup'));
    expect((api.mock.calls[0] as unknown as [string])[0]).toBe('/business/orgs');
  });
});
