import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org, venue, zone } from '../fixtures';
import type { Org, ZoneSchedule } from '../types';
import { SchedulesPage } from './SchedulesPage';

const venues = [
  venue('camden', 'Camden', { zones: [zone('camden', 'camden-bar', 'Bar')] }),
  venue('soho', 'Soho', { open_now: false, zones: [zone('soho', 'soho-bar', 'Bar')] }),
];
const SCHEDULE: ZoneSchedule = { zone_id: '', version: 3, dayparts: [{ id: 'late', name: 'Late peak', start: 1320, end: 1560, energy: 'peak' }] };

function renderBoard({ role, conflicts = [] }: { role?: Org['role']; conflicts?: unknown[] } = {}) {
  const client = {
    schedule: vi.fn(async () => SCHEDULE),
    previewApply: vi.fn(async (_org: string, body: { venue_ids: string[] }) => ({ venues: body.venue_ids.length, open_now: 1, conflicts })),
    apply: vi.fn(async (_org: string, body: { venue_ids: string[] }) => ({ applied: body.venue_ids.length })),
  };
  const ctx = {
    org: org(role ? { role } : {}), venues, devices: [], activity: [], client, now: NOW, offline: false, updatedAt: NOW,
    health: 'ok', loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as unknown as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}><SchedulesPage /></BusinessContext.Provider>);
  return client;
}

describe('ScheduleBoard (BZ-0453-10)', () => {
  it('draws each zone schedule as blocks in venue time, overnight blocks split at midnight', async () => {
    const client = renderBoard();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Late peak, 22:00 to 02:00/ })).toHaveLength(4));
    expect(client.schedule).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Schedule board' })).toBeInTheDocument();
  });

  it('asks for venues and a template before previewing, then applies with the versions', async () => {
    const client = renderBoard();
    await screen.findAllByRole('button', { name: /Late peak/ });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one venue first');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Choose Camden' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'bar_evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/Changes 1 venue\. 1 is open now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Applied to 1 venue')).toBeInTheDocument();
    expect(client.apply).toHaveBeenCalledWith(expect.any(String), { venue_ids: ['camden'], template: 'bar_evening', dayparts: undefined, versions: { 'camden-bar': 3 } });
  });

  it('edits one block with an overnight end and refuses a bad time', async () => {
    const client = renderBoard();
    fireEvent.click((await screen.findAllByRole('button', { name: /Late peak/ }))[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /Ends/ }), { target: { value: '25:7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview this change' }));
    expect(await screen.findByText('Use the 24 hour clock, for example 18:30')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Ends/ }), { target: { value: '25:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview this change' }));
    await waitFor(() => expect(client.previewApply).toHaveBeenCalled());
    expect(client.previewApply.mock.calls[0][1]).toMatchObject({ venue_ids: ['camden'], dayparts: [{ id: 'late', start: 1320, end: 1530 }] });
  });

  it('keeps the other editor version for a venue when chosen, so nothing changes there', async () => {
    const client = renderBoard({ conflicts: [{ venue_id: 'camden', zone_id: 'camden-bar', updated_by: 'Sam Manager', updated_at: NOW - 120, theirs: [], ours: [] }] });
    await screen.findAllByRole('button', { name: /Late peak/ });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Choose Camden' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'cafe_day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/Changed by Sam 2 minutes ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Keep theirs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Every venue kept its own version, so nothing changed')).toBeInTheDocument();
    expect(client.apply).not.toHaveBeenCalled();
  });

  it('shows a viewer the board without any apply controls', async () => {
    renderBoard({ role: 'viewer' });
    await screen.findAllByText('Late peak');
    expect(screen.queryByRole('button', { name: 'Preview changes' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
