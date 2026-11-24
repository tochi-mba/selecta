// ADR-0475 R12: one browser profile is signed in to one account at a time, and every tab of it
// agrees at once. A sign-out or sign-in in one tab is told to the others over a BroadcastChannel
// (with the `storage` event as the fallback where there is no channel). Before signing out, the
// tab asks the others whether any of them is playing, hosting an open room or importing, so the
// person can be told what signing out will stop.

export type TabBusy = { playing: boolean; room: boolean; importing: boolean };
export type AccountMessage =
  | { kind: 'signed-out'; userId: string | null }
  | { kind: 'signed-in'; userId: string; email: string }
  | { kind: 'busy?'; id: string }
  | { kind: 'busy'; id: string; state: TabBusy };

const NAME = 'selecta-account';
const STORAGE_KEY = 'selecta.account.message';
const NOTHING: TabBusy = { playing: false, room: false, importing: false };
// what this tab is doing now, kept current by the shell
let here: TabBusy = NOTHING;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(message: AccountMessage) => void>();

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(NAME);
  channel.addEventListener('message', (event) => heard(event.data as AccountMessage));
  return channel;
}

function heard(message: AccountMessage) {
  if (!message || typeof message !== 'object') return;
  if (message.kind === 'busy?') { post({ kind: 'busy', id: message.id, state: here }); return; }
  for (const listen of listeners) listen(message);
}

function post(message: AccountMessage) {
  const sent = open();
  if (sent) { sent.postMessage(message); return; }
  // no channel: the storage event reaches the other tabs of this browser
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, at: Date.now() })); } catch { /* nothing to tell with */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue || typeof BroadcastChannel !== 'undefined') return;
    try { heard(JSON.parse(event.newValue) as AccountMessage); } catch { /* not ours */ }
  });
}

/** What this tab is doing, so a sign-out pressed in another tab can say what it will stop. */
export function setTabBusy(state: Partial<TabBusy>): void {
  here = { ...here, ...state };
}

/** Listen for the other tabs' sign-outs and sign-ins. */
export function onAccountMessage(listen: (message: AccountMessage) => void): () => void {
  open();
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}

export const announceSignedOut = (userId: string | null) => post({ kind: 'signed-out', userId });
export const announceSignedIn = (userId: string, email: string) => post({ kind: 'signed-in', userId, email });

/** What every tab of this browser (this one included) is doing, answered within `waitMs`. */
export function whatTabsAreDoing(waitMs = 300): Promise<TabBusy> {
  const asked = open();
  if (!asked) return Promise.resolve(here);
  const id = `${Date.now()}-${Math.random()}`;
  let all: TabBusy = { ...here };
  return new Promise((done) => {
    const hear = (event: MessageEvent) => {
      const message = event.data as AccountMessage;
      if (message?.kind !== 'busy' || message.id !== id) return;
      all = { playing: all.playing || message.state.playing, room: all.room || message.state.room, importing: all.importing || message.state.importing };
    };
    asked.addEventListener('message', hear);
    asked.postMessage({ kind: 'busy?', id } satisfies AccountMessage);
    window.setTimeout(() => { asked.removeEventListener('message', hear); done(all); }, waitMs);
  });
}

/** The one sentence a sign-out confirms first, or null when nothing would be stopped. */
export function signOutWarning(busy: TabBusy): string | null {
  const stops = [busy.playing && 'stops the music', busy.room && 'closes your room for guests', busy.importing && 'pauses adding your music'].filter(Boolean) as string[];
  if (!stops.length) return null;
  const said = stops.length === 1 ? stops[0] : `${stops.slice(0, -1).join(', ')} and ${stops.at(-1)}`;
  return `Signing out ${said}.`;
}
