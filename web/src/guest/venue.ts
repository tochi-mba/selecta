// The guest page for a venue's standing room (ADR-0451): a table card's /r/{code}?at=venue link.
// Loaded by main.ts only for venue cards, so the party-room page stays as small as it was.
//
// Join, see what's playing in this zone, search the songs the venue allows here now and ask for
// one, vote on what's coming up and follow your own requests. Guests never see staff names,
// devices, billing or licences, and never why a song isn't there. The venue's accent colour is
// used on the header band and the main button only when the server says it passes 4.5:1 in
// both themes. The guest token lives in an HttpOnly cookie the page can't read.

import { ApiError, call, h, patch, replace, type Song } from '../rooms/dom';
import * as social from './social/social';

type Branding = { venue_name: string; zone_name: string; footer: string; logo_url: string | null; welcome: string | null; accent: string | null; accent_ink: string | null };
type Asked = { request_id: string; title: string; artist: string; votes: number; mine: boolean };
type Mine = { request_id: string; title: string; artist: string; status: string; text: string; votes: number };
type State = {
  room_id: string; state: string; text: string; can_request: boolean; needs_screen_code: boolean; nickname: string;
  branding: Branding; now_playing: Song | null; coming_up: Asked[]; my_requests: Mine[];
  /** ADR-0488: the room's name as the shared features know it (the zone), and this guest's own
   * dedications by request. The rest of what they read is `social.RoomView`. */
  room_name: string; my_dedications?: Record<string, { line: string; words: string | null }>;
} & Omit<social.RoomView, 'room_name' | 'now_playing'>;
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
  let wait = 0;
  let searching = false;
  let recapAsked = false;
  let recapLines: string[] = [];
  // ADR-0488: what the room does together. A standing room has no end, so songs a guest keeps
  // are filed by the room and the day.
  social.init({
    base: () => base, shelf: () => `${code}:${new Date().toISOString().slice(0, 10)}`,
    redraw: () => draw(), reread: () => void refresh(), say: (text) => { notice = text; draw(); }, buzz: () => undefined,
  });
  // taps being answered ("ask:12", "vote:r1"): that button shows it is working and ignores a second tap
  const busy = new Set<string>();
  const working = (on: boolean): Record<string, string> => (on ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {});

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
    if (button.getAttribute('aria-busy')) return;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    button.textContent = 'Joining...';
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
      const fresh = await call<State>(`${base}/state`);
      state = { ...fresh, room_name: fresh.branding.zone_name, now_playing: fresh.now_playing && { ...fresh.now_playing, length_s: fresh.now_playing.length_s ?? 0 } };
      // ADR-0488: once the zone has closed for the night, its numbers are asked for once
      if (state.state === 'closed' && !recapAsked) {
        recapAsked = true;
        void call<{ lines: string[] }>(`${base}/recap`).then((answer) => { recapLines = answer.lines ?? []; draw(); }, () => undefined);
      }
      if (state.state !== 'closed') { recapAsked = false; recapLines = []; }
      draw();
    } catch (error) {
      if (fail(error)) return;
      draw();
    }
    timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
  }

  // typing waits a moment before asking, and the list shows the outline of rows meanwhile
  function typed(text: string): void {
    query = text;
    window.clearTimeout(wait);
    if (!text.trim()) { found = []; searching = false; draw(); return; }
    searching = true;
    draw();
    wait = window.setTimeout(() => void search(text), 250);
  }

  async function search(text: string): Promise<void> {
    try {
      const answer = await call<{ songs: Found[] }>(`${base}/search?q=${encodeURIComponent(text.slice(0, 100))}`);
      if (query === text) { found = answer.songs; searching = false; draw(); }
    } catch (error) { if (query === text) { searching = false; if (!fail(error)) draw(); } }
  }

  async function ask(song: Found): Promise<void> {
    const key = `ask:${song.song_id}`;
    if (busy.has(key)) return;
    busy.add(key);
    draw();
    try {
      const body = JSON.stringify({ song_id: song.song_id, screen_code: screenCode || null });
      const answer = await call<{ became_vote: boolean }>(`${base}/requests`, { method: 'POST', body });
      notice = answer.became_vote ? `Someone already asked for ${song.title}. Your vote is in.` : `Asked for ${song.title}.`;
      found = [];
      query = '';
      busy.delete(key);
      const box = root.querySelector<HTMLInputElement>('input[type=search]');
      if (box) box.value = '';
      await refresh();
    } catch (error) { busy.delete(key); if (!fail(error)) draw(); }
  }

  async function vote(item: Asked): Promise<void> {
    const key = `vote:${item.request_id}`;
    if (busy.has(key)) return;
    busy.add(key);
    draw();
    try {
      await call(`${base}/requests/${encodeURIComponent(item.request_id)}/vote`, { method: 'POST' });
      busy.delete(key);
      await refresh();
    } catch (error) { busy.delete(key); if (!fail(error)) draw(); }
  }

  function draw(): void {
    if (!state) return;
    const view = state;
    const brand = state.branding;
    const band = h('header', { className: 'g-brand', 'data-key': 'brand', style: accentStyle(brand) },
      brand.logo_url ? h('img', { src: brand.logo_url, alt: '', className: 'g-logo', width: 48, height: 48 }) : null,
      h('p', { className: 'g-eyebrow' }, brand.venue_name),
      h('h1', {}, brand.zone_name));
    const parts: (Node | null)[] = [band];
    if (brand.welcome) parts.push(h('p', { 'data-key': 'welcome' }, brand.welcome));
    parts.push(h('p', { className: 'g-status', 'data-key': 'state' }, state.text));
    if (state.now_playing) parts.push(h('p', { className: 'g-now', 'data-key': 'now' }, `Now: ${state.now_playing.title} by ${state.now_playing.artist}`));
    // ADR-0488: the heart and the dedication for the playing song, then the vote for the next
    parts.push(social.hero(state), social.round(state), social.recapCard(recapLines));
    if (state.can_request) {
      if (state.needs_screen_code) {
        parts.push(h('label', { className: 'g-field', 'data-key': 'code' }, 'Code on the screen', h('input', { value: screenCode, inputmode: 'text', maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', oninput: (event: Event) => { screenCode = (event.target as HTMLInputElement).value.toUpperCase(); } })));
      }
      parts.push(h('div', { className: 'g-search-box', 'data-key': 'search' },
        h('input', { type: 'search', placeholder: 'Search songs', 'aria-label': 'Search songs', autocomplete: 'off', enterkeyhint: 'search', oninput: (event: Event) => typed((event.target as HTMLInputElement).value) })));
      if (found.length) {
        parts.push(h('ul', { className: 'g-list', 'data-key': 'found', 'aria-busy': searching ? 'true' : undefined }, ...found.map((song) => {
          const asking = busy.has(`ask:${song.song_id}`);
          return h('li', { 'data-key': `found-${song.song_id}` },
            h('span', { className: 'g-song' }, `${song.title} by ${song.artist}`),
            h('button', { type: 'button', className: 'g-primary g-small-button', style: accentStyle(brand), ...working(asking), 'aria-label': `Ask for ${song.title} by ${song.artist}`, onclick: () => void ask(song) }, asking ? 'Asking...' : 'Ask'));
        })));
      } else if (searching) {
        parts.push(h('ul', { className: 'g-list', 'data-key': 'outline', 'aria-hidden': 'true' }, ...[0, 1, 2].map((index) => h('li', { className: 'g-skel', 'data-key': `skel-${index}` }, h('span', { className: 'g-song' }, h('i'), h('i')), h('i')))));
      } else if (query.trim()) parts.push(h('p', { className: 'g-muted', 'data-key': 'none' }, `Nothing here matches "${query.trim()}". Try another search.`));
    }
    if (state.coming_up.length) {
      parts.push(h('h2', { 'data-key': 'coming-title' }, 'Coming up'), h('ul', { className: 'g-list', 'data-key': 'coming' }, ...state.coming_up.map((item) => h('li', { 'data-key': item.request_id },
        h('span', { className: 'g-song' }, `${item.title} by ${item.artist}`),
        item.mine ? h('span', { className: 'g-muted' }, 'Yours') : h('button', { type: 'button', className: 'g-vote', ...working(busy.has(`vote:${item.request_id}`)), 'aria-label': `Vote for ${item.title} by ${item.artist}, ${item.votes} so far`, onclick: () => void vote(item) }, String(item.votes))))));
    }
    if (state.my_requests.length) {
      parts.push(h('h2', { 'data-key': 'mine-title' }, 'Your requests'), h('ul', { className: 'g-list', 'data-key': 'mine' }, ...state.my_requests.map((item) => h('li', { 'data-key': item.request_id },
        h('span', { className: 'g-song' }, `${item.title} by ${item.artist}`),
        h('p', { className: `g-status g-${item.status}` }, item.text),
        // a venue's "approved" is what the shared features call accepted: still waiting to play
        social.dedication(view, { request_id: item.request_id, status: item.status === 'approved' ? 'accepted' : item.status, dedication: view.my_dedications?.[item.request_id]?.line, dedication_words: view.my_dedications?.[item.request_id]?.words })))));
    }
    parts.push(social.kept(state));
    parts.push(h('footer', { className: 'g-small g-muted', 'data-key': 'footer' }, `You're ${state.nickname}. ${brand.footer}`));
    // what just happened floats over the bottom of the page, so it never pushes the page down
    parts.push(h('div', { className: 'g-dock', 'data-key': 'dock', 'data-open': notice ? true : undefined },
      h('div', { className: 'g-toast', onclick: () => { notice = ''; draw(); } }, h('p', { className: 'g-notice', role: 'status' }, notice))));
    // patched in place (keyed), so a poll never takes focus or typing from the guest
    let card = root.querySelector(':scope > .g-venue');
    if (!card) { card = h('section', { className: 'g-card g-venue' }); replace(root, card); }
    patch(card, ...parts);
    social.sync(state, state.state === 'open' || state.state === 'music_paused');
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) void refresh(); });
  void refresh();
}
