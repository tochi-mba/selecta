// The venue guest page (ADR-0451): branding only when the server approved the accent, no staff,
// device, billing or licence words, closed rooms say when they open, and the flag-off text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accentStyle, startVenue } from './venue';

const STATE = {
  room_id: 'r1', state: 'open', text: 'Ask for a song', can_request: true, needs_screen_code: false, nickname: 'Blue Otter',
  branding: { venue_name: 'The Crown', zone_name: 'Terrace', footer: 'Powered by SelectaDJ', logo_url: null, welcome: 'Brunch tunes till 3', accent: '#1d4ed8', accent_ink: '#f5f2e9' },
  now_playing: { title: 'Morning Paper', artist: 'Lumen Trio' }, coming_up: [], my_requests: [],
};

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, 0));
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('the venue guest page', () => {
  it('uses the accent only when the server approved it', () => {
    expect(accentStyle({ accent: '#1d4ed8', accent_ink: '#f5f2e9' })).toBe('background:#1d4ed8;color:#f5f2e9');
    expect(accentStyle({ accent: null, accent_ink: null })).toBe('');
  });

  it('shows the venue, zone, welcome and what is playing, with no staff or device words', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(STATE)));
    const root = document.createElement('main');
    document.body.append(root);
    startVenue(root, 'K7QDM2XP');
    await settle();
    expect(root.textContent).toContain('The Crown');
    expect(root.textContent).toContain('Terrace');
    expect(root.textContent).toContain('Brunch tunes till 3');
    expect(root.textContent).toContain('Now: Morning Paper by Lumen Trio');
    expect(root.textContent).toContain('Powered by SelectaDJ');
    for (const word of ['tablet', 'kiosk', 'billing', 'licence', 'offline']) expect(root.textContent?.toLowerCase()).not.toContain(word);
  });

  it('says when requests open on a closed card, and the flag-off words', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ ...STATE, state: 'closed', text: 'Requests open at 17:00', can_request: false, now_playing: null })));
    const root = document.createElement('main');
    startVenue(root, 'K7QDM2XP');
    await settle();
    expect(root.textContent).toContain('Requests open at 17:00');
    expect(root.querySelector('input[type=search]')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => respond({ detail: { code: 'flag_off', message: "Requests aren't available here" } }, 404)));
    const off = document.createElement('main');
    startVenue(off, 'K7QDM2XP');
    await settle();
    expect(off.textContent).toContain("Requests aren't available here");
  });
});
