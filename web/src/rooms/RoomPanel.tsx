import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Action } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, ELLIPSIS } from '../ui/format';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { groupGuests, guestPresence, guestsHeading, presenceChanges, screenPresence } from './presence';
import { qrSvg } from './qr';
import './rooms.css';

// The host's room panel on Listen (ADR-0416): open a room, show its QR code and code, change
// who can join and how requests work, approve or pass requests, let guests in, remove or ban
// them, make a new code, pair a big screen and end the room. Rooms are Premium; other plans see
// what it is and which plan has it.
//
// Guests and screens show whether they are really here ("Here now", "Away · last seen 5 min
// ago", "Screen 1 · offline since 21:04") from the server's heartbeat, updated by the 3 s poll
// (useVisiblePoll: paused while the tab is hidden, read at once on return); changes are announced
// politely, at most once every 10 s. Every button is an Action, busy until its answer is back;
// Remove, Ban and a new code ask first in a ConfirmDialog, since none of them can be undone.

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Song = { song_id: number; title: string; artist: string; length_s: number };
type Item = { request_id: string; song: Song | null; status: string; votes: number; nickname: string | null };
type Guest = { id: string; nickname: string; status: string; joined_at?: number; last_seen_at?: number; online?: boolean };
type Screen = { id: string; label: string; paired_at: number | null; last_seen_at: number | null; online: boolean };
type Confirm = { title: string; body: string; confirmLabel: string; run: () => Promise<unknown> };
type Settings = { join_mode: string; request_mode: string; votes: boolean; names_shown: boolean; display: boolean };
type Panel = {
  room: { id: string; name: string; status: string; settings: Settings; ends_at: number };
  code: string | null; join_path: string | null; guests: Guest[]; inbox: Item[]; coming_up: Item[]; unfit: Item[];
  renders_left: number; music_paused: boolean; displays: number; screens?: Screen[]; now?: number;
};

const POLL_MS = 3000;
const ANNOUNCE_EVERY_MS = 10_000;
const songText = (song: Song | null) => (song ? `${song.title} - ${song.artist}` : 'A song');

export function RoomPanel({ api, workspaceId, locked, votesOn = true, displayOn = true, playHereOn = true, freshOnly = false, origin = window.location.origin }: {
  api: Api; workspaceId: string; locked?: string; votesOn?: boolean; displayOn?: boolean; playHereOn?: boolean; origin?: string;
  /** ADR-0422 (rooms.nickname_confirm): a poll that overlapped one of the host's own changes is dropped. */
  freshOnly?: boolean;
}) {
  // ADR-0422: bumped when a host change goes out and when it's answered; a poll that saw either is stale.
  const hostChanges = useRef(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState('');
  const [removeEveryone, setRemoveEveryone] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [presenceSaid, setPresenceSaid] = useState('');
  const seen = useRef<{ guests: Guest[]; screens: Screen[] } | null>(null);
  const queued = useRef<string[]>([]);
  const lastAnnounced = useRef(0);
  const announceTimer = useRef(0);

  // Polite, rate-limited: changes that arrive within 10 s of the last announcement wait and are
  // said together, so a room full of phones locking and unlocking doesn't chatter.
  const announce = useCallback((changes: string[]) => {
    if (changes.length) queued.current.push(...changes);
    if (!queued.current.length || announceTimer.current) return;
    const wait = Math.max(0, lastAnnounced.current + ANNOUNCE_EVERY_MS - Date.now());
    announceTimer.current = window.setTimeout(() => {
      announceTimer.current = 0;
      lastAnnounced.current = Date.now();
      const words = queued.current.splice(0);
      setPresenceSaid(words.length > 3 ? `${words.slice(0, 3).join(' ')} And ${words.length - 3} more changes.` : words.join(' '));
    }, wait);
  }, []);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);
  useEffect(() => {
    if (!panel) { seen.current = null; return; }
    const next = { guests: panel.guests, screens: panel.screens ?? [] };
    announce(presenceChanges(seen.current, next));
    seen.current = next;
  }, [panel, announce]);

  const load = useCallback(async () => {
    const asked = hostChanges.current;
    try {
      const answer = await api<{ room: Panel | null }>('/rooms/current', {}, workspaceId);
      if (freshOnly && asked !== hostChanges.current) return;
      setPanel(answer.room); setLoaded(true);
    } catch (problem) { setError((problem as Error).message); setLoaded(true); }
  }, [api, workspaceId, freshOnly]);
  useEffect(() => {
    if (!locked) void load();
  }, [load, locked]);
  useVisiblePoll(load, POLL_MS, !locked);

  const act = async (path: string, init: RequestInit = { method: 'POST' }, success = '') => {
    hostChanges.current += 1;
    try {
      const next = await api<Panel>(path, init, workspaceId);
      hostChanges.current += 1;
      setPanel(next.room.status === 'ended' ? null : next);
      setError(''); setSaid(success);
      return true;
    } catch (problem) { setError((problem as Error).message); return false; }
  };

  if (locked) {
    return (
      <section className="room-panel room-locked" aria-labelledby="room-title">
        <h2 id="room-title">Rooms <span className="room-plan">{locked[0]?.toUpperCase()}{locked.slice(1)}</span></h2>
        <p>Share a QR code at a party and let guests request songs from your library. SelectaDJ fits them into the mix. Rooms are part of {locked[0]?.toUpperCase()}{locked.slice(1)}.</p>
      </section>
    );
  }

  if (!loaded) return <section className="room-panel" aria-busy="true"><h2 id="room-title">Room</h2><p>{`Loading${ELLIPSIS}`}</p></section>;

  if (!panel) {
    const open = () => act('/rooms', { method: 'POST', body: JSON.stringify({ name: name || 'Party', settings: {} }) }, 'Room open.');
    return (
      <section className="room-panel" aria-labelledby="room-title">
        <h2 id="room-title">Open a room</h2>
        {/* After End room the panel comes back here, so the ending is said here, not lost. */}
        {said && <p className="room-said" role="status">{said}</p>}
        <p>Guests scan a QR code and request songs from their phones. No app, no account, and nothing plays on their phones.</p>
        {/* one field, so Enter still sends the form; the button is an Action so it shows it's busy */}
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void open(); }} className="room-row">
          <label htmlFor="room-name">Room name guests will see</label>
          <input id="room-name" value={name} maxLength={40} placeholder="Party" onChange={(event) => setName(event.target.value)} />
          <Action type="button" className="primary" run={open} working={`Opening${ELLIPSIS}`}>Open room</Action>
        </form>
        {error && <p className="room-error" role="alert">{error}</p>}
      </section>
    );
  }

  const room = panel.room;
  const base = `/rooms/${encodeURIComponent(room.id)}`;
  const link = panel.join_path ? `${origin}${panel.join_path}` : '';
  const settings = room.settings;
  const save = (change: Partial<Settings>) => void act(`${base}/settings`, { method: 'PATCH', body: JSON.stringify(change) }, 'Saved.');
  const now = panel.now ?? Date.now() / 1000;
  const groups = groupGuests(panel.guests, now);
  const pair = () => act(`${base}/displays`, { method: 'POST', body: JSON.stringify({ pairing_code: pairing }) }, 'Screen paired.').then((ok) => { if (ok) setPairing(''); });
  const screens = panel.screens ?? [];
  const guestRow = (guest: Guest) => (
    <li key={guest.id} data-testid="room-guest" data-presence={guest.online ? 'here' : 'away'}>
      <span>{guest.nickname}{guest.status === 'pending' ? ' · waiting to be let in' : ''}
        <span className={guest.online ? 'room-presence room-here' : 'room-presence room-muted'} data-testid="room-guest-presence"> · {guestPresence(guest, now)}</span></span>
      {guest.status === 'pending' && <Action type="button" className="primary" run={() => act(`${base}/guests/${guest.id}/approve`)}>Let in</Action>}
      <Action type="button" aria-label={`Remove ${guest.nickname}`} run={() => setConfirm({
        title: `Remove ${guest.nickname}?`,
        body: 'They leave the room now and their requests stay. They can scan the code again and join as someone new; to keep them out, ban them instead.',
        confirmLabel: 'Remove',
        run: () => act(`${base}/guests/${guest.id}/remove`, { method: 'POST' }, `${guest.nickname} was removed.`),
      })}>Remove</Action>
      <Action type="button" aria-label={`Ban ${guest.nickname}`} run={() => setConfirm({
        title: `Ban ${guest.nickname}?`,
        body: "They can't come back to this room. Their waiting requests are withdrawn and their votes taken back.",
        confirmLabel: 'Ban',
        run: () => act(`${base}/guests/${guest.id}/ban`, { method: 'POST' }, `${guest.nickname} is banned for this room.`),
      })}>Ban</Action></li>
  );

  return (
    <section className="room-panel" aria-labelledby="room-title">
      <header className="room-head">
        <h2 id="room-title">{room.name}</h2>
        <span className="room-status" data-testid="room-status">{room.status === 'locked' ? 'Locked: no new guests' : 'Open'}</span>
      </header>
      {panel.music_paused && <p className="room-banner">{`No speaker is playing, so guests see "The music's paused".${playHereOn ? ' Press Play here on a device to start.' : ''}`}</p>}
      <div className="room-share">
        {link && <div className="room-qr" data-testid="room-qr" data-link={link} dangerouslySetInnerHTML={{ __html: qrSvg(link, `QR code to join ${room.name}`) }} />}
        <div>
          <p className="room-code-label">Room code</p>
          <p className="room-code" data-testid="room-code">{panel.code}</p>
          <p className="room-link"><a href={link} target="_blank" rel="noreferrer">{link}</a></p>
          <div className="room-row">
            <Action type="button" run={() => act(`${base}/${room.status === 'locked' ? 'unlock' : 'lock'}`)}>{room.status === 'locked' ? 'Unlock' : 'Lock room'}</Action>
            <Action type="button" run={() => setConfirm({
              title: 'Make a new code?',
              body: `The old QR code stops working the moment the new one exists.${removeEveryone ? ' Everyone in the room is removed too.' : ''}`,
              confirmLabel: 'Make a new code',
              run: () => act(`${base}/code`, { method: 'POST', body: JSON.stringify({ remove_everyone: removeEveryone }) }, 'New code made. The old one no longer works.'),
            })}>Make a new code</Action>
            <label className="room-check"><input type="checkbox" checked={removeEveryone} onChange={(event) => setRemoveEveryone(event.target.checked)} /> and remove everyone</label>
          </div>
        </div>
      </div>
      {said && <p className="room-said" role="status">{said}</p>}
      <p className="room-sr" role="status" aria-live="polite" data-testid="room-presence-said">{presenceSaid}</p>
      {error && <p className="room-error" role="alert">{error}</p>}

      <fieldset className="room-settings">
        <legend>Settings</legend>
        <label>Who can join <select aria-label="Who can join" value={settings.join_mode} onChange={(event) => save({ join_mode: event.target.value })}>
          <option value="anyone">Anyone with the code</option><option value="approve">I approve each new guest</option><option value="locked">Locked: no new guests</option>
        </select></label>
        <label>Requests <select aria-label="Requests" value={settings.request_mode} onChange={(event) => save({ request_mode: event.target.value })}>
          <option value="auto">Accept automatically</option><option value="approve">I approve each</option><option value="off">Off (watch only)</option>
        </select></label>
        {votesOn && <label className="room-check"><input type="checkbox" checked={settings.votes} onChange={(event) => save({ votes: event.target.checked })} /> Guests can vote</label>}
        <label className="room-check"><input type="checkbox" checked={settings.names_shown} onChange={(event) => save({ names_shown: event.target.checked })} /> Show guest nicknames to everyone</label>
      </fieldset>

      <section aria-labelledby="inbox-title">
        <h3 id="inbox-title">Requests waiting for you ({panel.inbox.length})</h3>
        {panel.inbox.length === 0 ? <p className="room-muted">Nothing waiting.</p> : (
          <ul className="room-list">{panel.inbox.map((item) => (
            <li key={item.request_id}><span>{songText(item.song)}<span className="room-muted"> · {item.nickname}{votesOn && settings.votes ? ` · ${countOf(item.votes, 'vote')}` : ''}</span></span>
              <Action type="button" className="primary" run={() => act(`${base}/requests/${item.request_id}/approve`)} aria-label={`Approve ${songText(item.song)}`}>Approve</Action>
              <Action type="button" run={() => act(`${base}/requests/${item.request_id}/pass`)} aria-label={`Pass on ${songText(item.song)}`}>Pass</Action></li>
          ))}</ul>
        )}
      </section>
      <section aria-labelledby="coming-title">
        <h3 id="coming-title">Coming up</h3>
        {panel.coming_up.length === 0 ? <p className="room-muted">No guest requests in the queue.</p> : (
          <ol className="room-list">{panel.coming_up.map((item) => <li key={item.request_id}><span>{songText(item.song)}<span className="room-muted"> · {item.nickname}</span></span></li>)}</ol>
        )}
        {panel.unfit.length > 0 && (<>
          <h3>Couldn't fit</h3>
          <ul className="room-list">{panel.unfit.map((item) => (
            <li key={item.request_id}><span>{songText(item.song)}</span><Action type="button" run={() => act(`${base}/requests/${item.request_id}/approve`)}>Try again</Action></li>
          ))}</ul>
        </>)}
        <p className="room-muted">{countOf(panel.renders_left, 'request render')} left this hour.</p>
      </section>
      <section aria-labelledby="guests-title">
        <h3 id="guests-title" data-testid="room-guests-heading">{guestsHeading(groups)}</h3>
        {!groups.here.length && !groups.away.length && !groups.gone.length && <p className="room-muted">No guests yet. They join with the code or the QR code.</p>}
        {(groups.here.length > 0 || groups.away.length > 0) && <ul className="room-list">{[...groups.here, ...groups.away].map(guestRow)}</ul>}
        {groups.gone.length > 0 && (
          <details className="room-gone" data-testid="room-guests-gone">
            <summary>Left or away ({groups.gone.length})</summary>
            <ul className="room-list">{groups.gone.map(guestRow)}</ul>
          </details>
        )}
      </section>
      {displayOn && (
        <section aria-labelledby="screen-title">
          <h3 id="screen-title">Big screen</h3>
          <p className="room-muted">Open {origin.replace(/^https?:\/\//, '')}/display on a TV or projector and type the code it shows.</p>
          {screens.length > 0 && (
            <ul className="room-list" data-testid="room-screens">{screens.map((screen) => (
              <li key={screen.id} data-testid="room-screen" data-presence={screen.online ? 'online' : 'offline'}>
                <span className={screen.online ? 'room-here' : 'room-muted'}>{screenPresence(screen)}</span>
                <Action type="button" run={() => act(`${base}/displays/${encodeURIComponent(screen.id)}`, { method: 'DELETE' }, `${screen.label} disconnected.`)} aria-label={`Disconnect ${screen.label}`}>Disconnect</Action></li>
            ))}</ul>
          )}
          <form className="room-row" onSubmit={(event) => { event.preventDefault(); void pair(); }}>
            <label htmlFor="pairing-code">Code on the screen</label>
            <input id="pairing-code" value={pairing} maxLength={8} autoComplete="off" onChange={(event) => setPairing(event.target.value)} />
            <Action type="button" run={pair} working={`Pairing${ELLIPSIS}`}>Pair screen</Action>
            {panel.displays > 0 && <Action type="button" run={() => act(`${base}/displays`, { method: 'DELETE' }, 'Screens disconnected.')}>Disconnect screens</Action>}
          </form>
        </section>
      )}
      <div className="room-row room-end">
        {confirmEnd ? (<>
          <span>End the room for everyone? Waiting requests are withdrawn.</span>
          <Action type="button" className="danger" run={() => act(`${base}/end`, { method: 'POST' }, 'Room ended.').then(() => setConfirmEnd(false))} working={`Ending${ELLIPSIS}`}>End room</Action>
          <Action type="button" run={() => setConfirmEnd(false)}>Keep it open</Action>
        </>) : <Action type="button" run={() => setConfirmEnd(true)}>End room</Action>}
      </div>
      {confirm && (
        <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} destructive
          onConfirm={confirm.run} onClose={() => setConfirm(null)} />
      )}
    </section>
  );
}
