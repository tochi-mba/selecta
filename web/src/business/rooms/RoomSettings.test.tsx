// Rooms for Business settings and the print sheet (ADR-0451): the room's controls call the real
// routes in the organisation workspace, branding, print and screen code vanish with their flags,
// rotation warns first, and every table card's QR code scans back to its zone's link.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import jsQR from 'jsqr';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { encodeQr } from '../../rooms/qr';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org, venue } from '../fixtures';
import { cardLinks, printSheetHtml } from './printSheet';
import { RoomSettings } from './RoomSettings';
import { ROOM_ROUTES, type PrintSheet, type RoomView } from './roomsClient';

const VIEW: RoomView = {
  zone_id: 'camden-bar', zone_name: 'Bar', room_id: 'r1', requests_on: true, mode: 'staff_approve', effective_mode: 'staff_approve',
  daypart_modes: {}, paused: false, flood_switched: false,
  limits: { pending_per_guest: 1, per_guest_per_hour: 3, song_cooldown_min: 60, pending_in_zone: 20, accepted_per_hour: 12, guests_at_once: 300, expiry_min: 20 },
  limit_ranges: { pending_per_guest: [1, 3], per_guest_per_hour: [1, 6], song_cooldown_min: [30, 240], pending_in_zone: [5, 50], accepted_per_hour: [1, 30], guests_at_once: [1, 300], expiry_min: [5, 60] },
  code: 'K7QD-M2XP', join_path: '/r/K7QDM2XP?at=venue', code_version: 1,
  welcome: null, accent: '#777777', logo_url: null, accent_used: false, accent_reason: 'Text on #777777 only reaches 4.2:1 contrast',
  screen_code_on: false,
};

function ctx(features: Record<string, boolean>, api: Api): BusinessCtx {
  const one = venue('camden', 'Camden');
  return {
    org: org({ features }), venues: [{ ...one, zones: [one.zones[0]] }], devices: [], activity: [], client: {} as BusinessCtx['client'],
    now: NOW, offline: false, updatedAt: NOW, health: { stream: 'live' }, loading: false, readOnly: false,
    refresh: async () => {}, go: vi.fn(), api,
  } as BusinessCtx;
}

function fakeApi() {
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/rotate')) return { code: 'ZZZZ-YYYY', join_path: '/r/ZZZZYYYY?at=venue', warning: 'Printed table cards stop working now.' };
    if (init?.method === 'PATCH') return { ...VIEW, ...JSON.parse(String(init.body)) };
    return VIEW;
  });
}

function show(features: Record<string, boolean>, api = fakeApi()) {
  const value = ctx(features, api as unknown as Api);
  render(<BusinessContext.Provider value={value}><RoomSettings venue={value.venues[0]} disabled={null} /></BusinessContext.Provider>);
  return api;
}

describe('room settings', () => {
  it('shows nothing while business.rooms is off', () => {
    const api = show({ 'business.rooms': false });
    expect(screen.queryByText('Guest request rooms')).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('reads the room in the organisation workspace and hides flagged parts', async () => {
    const api = show({ 'business.rooms': true });
    expect(await screen.findByText('K7QD-M2XP')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(ROOM_ROUTES.room('camden-bar'), undefined, org().id);
    expect(screen.queryByText('How the guest page looks')).toBeNull();
    expect(screen.queryByText('Code on the screen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print table cards and posters' })).toBeNull();
  });

  it('shows branding with the contrast reason, the screen code and print when their flags are on', async () => {
    show({ 'business.rooms': true, 'business.rooms.branding': true, 'business.rooms.screen_code': true, 'business.rooms.print': true });
    expect(await screen.findByText('How the guest page looks')).toBeInTheDocument();
    expect(screen.getByText(/only reaches 4.2:1/)).toBeInTheDocument();
    expect(screen.getByText('Code on the screen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print table cards and posters' })).toBeInTheDocument();
  });

  it('warns before rotating the code and only rotates when confirmed', async () => {
    const api = show({ 'business.rooms': true });
    await userEvent.click(await screen.findByRole('button', { name: 'Make a new code' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Printed table cards and posters with the old code stop working');
    expect(api.mock.calls.some(([path]) => String(path).endsWith('/rotate'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make the new code' }));
    expect(api.mock.calls.some(([path]) => path === ROOM_ROUTES.rotate('camden-bar'))).toBe(true);
  });

  it('refuses limits outside their range before saving', async () => {
    show({ 'business.rooms': true });
    const field = await screen.findByLabelText('Waiting requests per guest');
    await userEvent.clear(field);
    await userEvent.type(field, '9');
    expect(screen.getByText('From 1 to 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled();
  });
});

function decode(text: string): string | null {
  const code = encodeQr(text);
  const scale = 4;
  const side = (code.size + 8) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  code.modules.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
    }
  }));
  return jsQR(pixels, side, side)?.data ?? null;
}

describe('the print sheet', () => {
  const sheet: PrintSheet = {
    venue_id: 'camden', venue_name: 'The <Crown>', logo_url: null,
    zones: [
      { zone_id: 'bar', zone_name: 'Bar', code: 'K7QD-M2XP', join_url: '/r/K7QDM2XP?at=venue', view_only: false },
      { zone_id: 'terrace', zone_name: 'Terrace & Garden', code: '2345-6789', join_url: '/r/23456789?at=venue', view_only: true },
    ],
  };

  it('puts each zone link in a QR code that scans back to it', () => {
    for (const { url } of cardLinks(sheet, 'https://selectadj.app/')) {
      expect(url.startsWith('https://selectadj.app/r/')).toBe(true);
      expect(decode(url)).toBe(url);
    }
  });

  it('escapes names, makes a card and a poster per zone and says when a card is view only', () => {
    const html = printSheetHtml(sheet, 'https://selectadj.app');
    expect(html).toContain('The &lt;Crown&gt;');
    expect(html).toContain('Terrace &amp; Garden');
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html.match(/class="poster"/g)).toHaveLength(2);
    expect(html).toContain('Scan to see what is playing');
    expect(html).toContain('Powered by SelectaDJ');
  });
});
