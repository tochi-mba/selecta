// The guest page for a venue's standing room (ADR-0451): a table card's /r/{code}?at=venue link.
// Loaded by main.ts only for venue cards, so the party-room page stays as small as it was.
//
// Join, see what's playing in this zone, search the songs the venue allows here now and ask for
// one, vote on what's coming up and follow your own requests. Guests never see staff names,
// devices, billing or licences, and never why a song isn't there. The venue's accent colour is
// used on the header band and the main button only when the server says it passes 4.5:1 in
// both themes. The guest token lives in an HttpOnly cookie the page can't read.

import { ApiError, call, h, replace } from '../rooms/dom';

type Branding = { venue_name: string; zone_name: string; footer: string; logo_url: string | null; welcome: string | null; accent: string | null; accent_ink: string | null };
type Asked = { request_id: string; title: string; artist: string; votes: number; mine: boolean };
type Mine = { request_id: string; title: string; artist: string; status: string; text: string; votes: number };
type State = {
  room_id: string; state: string; text: string; can_request: boolean; needs_screen_code: boolean; nickname: string;
  branding: Branding; now_playing: { title: string; artist: string } | null; coming_up: Asked[]; my_requests: Mine[];
};
type Found = { song_id: string; title: string; artist: string; length_s: number | null };

const POLL_MS = 5000;
const UNAVAILABLE = "Requests aren't available here";

/** Visible for tests: the accent styles to apply, or none when the server didn't approve one. */
export function accentStyle(branding: Pick<Branding, 'accent' | 'accent_ink'>): string {
  return branding.accent && branding.accent_ink ? `background:${branding.accent};color:${branding.accent_ink}` : '';
}

export function startVenue(root: HTMLElement, code: string): void {
  const base = `/api/venue-rooms/${encodeURIComponent(code)}`;
  let state: State | null = null;
  let timer = 0;
  let found: Found[] = [];
  let query = '';
  let notice = '';
  let screenCode = '';

  const card = (...children: (Node | string | null)[]) => replace(root, h('section', { className: 'g-card' }, ...children));
  const fail = (error: unknown) => {
    const problem = error as ApiError;
    if (problem.code === 'flag_off') { card(h('h1', {}, UNAVAILABLE)); return true; }
    if (problem.status === 401) { joinScreen(); return true; }
    if (problem.code === 'banned') { card(h('h1', {}, "You can't ask for songs here"), h('p', {}, problem.message)); return true; }
    if (problem.code === 'code_changed') { card(h('h1', {}, problem.message)); return true; }
    notice = problem.message;
    return false;
  };

  function joinScreen(error = ''): void {
    window.clearTimeout(timer);
    const button = h('button', { className: 'g-primary', type: 'button', onclick: () => void join(button as HTMLButtonElement) }, 'Join');
    card(h('p', { className: 'g-eyebrow' }, 'SelectaDJ requests'), h('h1', {}, 'Ask for a song'),
      h('p', {}, "You'll see what's playing here and can ask for songs. Nothing plays on your phone."),
      error ? h('p', { className: 'g-error', role: 'alert' }, error) : null, button);
  }

  async function join(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await call(`${base}/join`, { method: 'POST' });
      await refresh();
    } catch (error) {
      if (!fail(error)) joinScreen((error as ApiError).message);
    }
  }

  async function refresh(): Promise<void> {
    window.clearTimeout(timer);
    try {
      state = await call<State>(`${base}/state`);
      draw();
    } catch (error) {
      if (fail(error)) return;
      draw();
    }
    timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
  }

  async function search(text: string): Promise<void> {
    query = text;
    if (!text.trim()) { found = []; draw(); return; }
    try {
      const answer = await call<{ songs: Found[] }>(`${base}/search?q=${encodeURIComponent(text.slice(0, 100))}`);
      if (query === text) { found = answer.songs; draw(); }
    } catch (error) { if (!fail(error)) draw(); }
  }

  async function ask(song: Found): Promise<void> {
    try {
      const body = JSON.stringify({ song_id: song.song_id, screen_code: screenCode || null });
      const answer = await call<{ became_vote: boolean }>(`${base}/requests`, { method: 'POST', body });
      notice = answer.became_vote ? `Someone already asked for ${song.title}. Your vote is in.` : `Asked for ${song.title}.`;
      found = [];
      query = '';
      await refresh();
    } catch (error) { if (!fail(error)) draw(); }
  }

  async function vote(item: Asked): Promise<void> {
    try {
      await call(`${base}/requests/${encodeURIComponent(item.request_id)}/vote`, { method: 'POST' });
      await refresh();
    } catch (error) { if (!fail(error)) draw(); }
  }

  function draw(): void {
    if (!state) return;
    const brand = state.branding;
    const band = h('header', { className: 'g-banner', style: accentStyle(brand) },
      brand.logo_url ? h('img', { src: brand.logo_url, alt: '', className: 'g-logo', width: 40, height: 40 }) : null,
      h('p', { className: 'g-eyebrow' }, brand.venue_name),
      h('h1', {}, brand.zone_name));
    const parts: (Node | null)[] = [band];
    if (brand.welcome) parts.push(h('p', {}, brand.welcome));
    parts.push(h('p', { className: 'g-status' }, state.text));
    if (state.now_playing) parts.push(h('p', { className: 'g-now' }, `Now: ${state.now_playing.title} by ${state.now_playing.artist}`));
    if (state.can_request) {
      if (state.needs_screen_code) {
        parts.push(h('label', {}, 'Code on the screen', h('input', { value: screenCode, inputMode: 'text', maxLength: 8, autocomplete: 'off', oninput: (event: Event) => { screenCode = (event.target as HTMLInputElement).value.toUpperCase(); } })));
      }
      const input = h('input', { type: 'search', value: query, placeholder: 'Search songs', 'aria-label': 'Search songs', oninput: (event: Event) => void search((event.target as HTMLInputElement).value) });
      parts.push(input);
      if (found.length) {
        parts.push(h('ul', { className: 'g-list' }, ...found.map((song) => h('li', { className: 'g-song' },
          h('span', {}, `${song.title} by ${song.artist}`),
          h('button', { type: 'button', className: 'g-primary', style: accentStyle(brand), onclick: () => void ask(song) }, 'Ask')))));
      } else if (query.trim()) parts.push(h('p', { className: 'g-muted' }, 'Nothing here matches. Try another search.'));
    }
    if (state.coming_up.length) {
      parts.push(h('h2', {}, 'Coming up'), h('ul', { className: 'g-list' }, ...state.coming_up.map((item) => h('li', { className: 'g-song' },
        h('span', {}, `${item.title} by ${item.artist}`),
        item.mine ? h('span', { className: 'g-muted' }, 'Yours') : h('button', { type: 'button', className: 'g-vote', onclick: () => void vote(item) }, `Vote (${item.votes})`)))));
    }
    if (state.my_requests.length) {
      parts.push(h('h2', {}, 'Your requests'), h('ul', { className: 'g-list' }, ...state.my_requests.map((item) => h('li', { className: 'g-song' },
        h('span', {}, `${item.title} by ${item.artist}`), h('span', { className: 'g-status' }, item.text)))));
    }
    parts.push(h('p', { className: 'g-notice', role: 'status' }, notice));
    parts.push(h('footer', { className: 'g-small g-muted' }, `You're ${state.nickname}. ${brand.footer}`));
    replace(root, h('section', { className: 'g-card' }, ...parts));
    const search = root.querySelector('input[type=search]') as HTMLInputElement | null;
    if (search && query) { search.focus(); search.setSelectionRange(query.length, query.length); }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) void refresh(); });
  void refresh();
}
