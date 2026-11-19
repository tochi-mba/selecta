import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org, venue, zone } from '../fixtures';
import { exceptionsOf, newSuggestions, weekOf, type HoursAnswer } from '../hoursAdapters';
import { HoursTab } from './HoursTab';

const ANSWER: HoursAnswer = {
  time_zone: 'Europe/London',
  periods: [
    { id: 'p1', zone_id: null, weekday: 4, opens: '18:00', closes: '02:00', all_day: false },
    { id: 'p2', zone_id: null, weekday: 0, opens: '10:00', closes: '23:00', all_day: false },
    { id: 'p3', zone_id: 'terrace', weekday: 0, opens: '12:00', closes: '20:00', all_day: false },
  ],
  exceptions: [{ id: 'x1', zone_id: null, date: '2026-12-25', until: null, closed: true, periods: [], repeat_yearly: true, note: 'Christmas Day' }],
};

describe('hours adapters (ADR-0444)', () => {
  it('reads the venue week with overnight closes on the opening day and leaves zone hours out', () => {
    const week = weekOf(ANSWER);
    expect(week.fri).toEqual([{ open: 1080, close: 1560 }]);
    expect(week.mon).toEqual([{ open: 600, close: 1380 }]);
    expect(weekOf(ANSWER, 'terrace').mon).toEqual([{ open: 720, close: 1200 }]);
  });

  it('never suggests a holiday already on the list', () => {
    const shown = newSuggestions([{ date: '2026-12-25', closed: true, note: 'Christmas Day' }, { date: '2026-12-26', closed: true, note: 'Boxing Day' }], exceptionsOf(ANSWER));
    expect(shown.map((item) => item.date)).toEqual(['2026-12-26']);
  });
});

function renderTab(role: 'owner' | 'viewer' = 'owner') {
  const client = {
    hours: vi.fn(async () => ANSWER),
    saveWeek: vi.fn(async () => ANSWER),
    addException: vi.fn(async () => ({ id: 'x2' })),
    removeException: vi.fn(async () => ({ deleted: 'x1' })),
    holidaySuggestions: vi.fn(async () => [{ date: '2026-12-26', closed: true, note: 'Boxing Day' }]),
    zoneState: vi.fn(async () => ({ state: 'open', since: null, next_state: 'closing', next_change: '2026-11-14T23:00:00+00:00', time_zone: 'Europe/London', open_late_until: null })),
    closeNow: vi.fn(async () => ({ id: 'o1', fade_seconds: 60, undo_seconds: 300 })),
    undoCloseNow: vi.fn(async () => ({ id: 'o1', undone: true })),
  };
  const place = venue('camden', 'Camden', { open_now: true, zones: [zone('camden', 'bar', 'Bar')] });
  const ctx = {
    org: org({ role }), venues: [place], devices: [], activity: [], client, now: NOW, offline: false, updatedAt: NOW,
    health: 'ok', loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as unknown as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}><HoursTab venue={place} disabled={role === 'viewer' ? 'You can look here but not change things' : null} /></BusinessContext.Provider>);
  return client;
}

describe('HoursTab (ADR-0444)', () => {
  it('shows the stored hours, the holidays and each zone state in venue time', async () => {
    renderTab();
    expect(await screen.findByText(/Times are in the venue's own time, Europe\/London/)).toBeInTheDocument();
    expect(screen.getByText(/Christmas Day/)).toBeInTheDocument();
    expect(await screen.findByTestId('zone-day-bar')).toHaveTextContent('Bar: Open. Closing at 23:00');
  });

  it('saves the week through PUT hours', async () => {
    const client = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Save opening hours' }));
    await waitFor(() => expect(client.saveWeek).toHaveBeenCalled());
    expect(client.saveWeek.mock.calls[0]).toEqual(['camden', expect.objectContaining({ fri: [{ open: 1080, close: 1560 }] })]);
  });

  it('adds a holiday suggestion only when asked', async () => {
    const client = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Show suggestions' }));
    const add = await screen.findByRole('button', { name: /Close on 26 December \(Boxing Day\)/ });
    expect(client.addException).not.toHaveBeenCalled();
    fireEvent.click(add);
    await waitFor(() => expect(client.addException).toHaveBeenCalledWith('camden', { date: '2026-12-26', closed: true, label: 'Boxing Day' }));
  });

  it('closes now and offers the undo', async () => {
    const client = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Close now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo close now' }));
    await waitFor(() => expect(client.undoCloseNow).toHaveBeenCalledWith('camden', 'o1'));
  });

  it('lets a viewer read but not change anything', async () => {
    renderTab('viewer');
    expect(await screen.findByRole('button', { name: 'Save opening hours' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close now' })).toBeDisabled();
  });
});
