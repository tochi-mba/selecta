import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PilotsPage, type PilotRow } from './PilotsPage';

// S8 (ADR-0453 BZ-0453-18): every pilot with its use against its allowance; each change asks for
// a reason and goes to the pilot's action route.

const NOW = Date.now() / 1000;
const ROW: PilotRow = { id: 'p1', org_id: 'org-1', org_name: 'Harbour Cafe', owner_email: 'owner@cafe.example', venues_used: 1, zones_used: 2, allowance: { venues: 1, zones: 3 }, starts_at: NOW - 86_400, ends_at: NOW + 59 * 86_400, status: 'active' };

describe('PilotsPage', () => {
  it('lists pilots and ends one with a reason', async () => {
    const api = vi.fn(async (path: string) => (path === '/admin/business/pilots' ? { pilots: [ROW] } : { pilot: { ...ROW, status: 'ended' } }));
    render(<PilotsPage api={api as never} />);
    expect(await screen.findByText('Harbour Cafe')).toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Harbour Cafe' }));
    fireEvent.click(screen.getByRole('button', { name: 'End pilot' }));
    fireEvent.change(screen.getByLabelText(/Reason for/), { target: { value: 'pilot finished' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'End pilot' })[0]);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/business/pilots/p1/end', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse((api.mock.calls.find((call) => call[0] === '/admin/business/pilots/p1/end') as unknown as [string, RequestInit])[1].body as string);
    expect(body.reason).toBe('pilot finished');
  });
});
