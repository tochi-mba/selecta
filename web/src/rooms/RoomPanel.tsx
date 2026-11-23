import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Action, Menu, Skeleton, Status } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, ELLIPSIS } from '../ui/format';
import { Icon } from '../ui/Icon';
import { MenuItem, VisuallyHidden } from '../ui/primitives';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { groupGuests, guestPresence, guestsHeading, presenceChanges, screenPresence } from './presence';
import { qrSvg } from './qr';
import type { LimitBounds } from './RoomLimits';
import { RoomSettings, type RoomSettingsValue, type SettingsGroup } from './RoomSettings';
import { ROOM_EVENT } from './useRoomSession';
import './rooms.css';
import { useNeedsConnection } from '../cloud/connection';
import '../cloud/connection.css';

// The host's room page (ADR-0416), in the order a host needs it: a status line (open or locked,
// guests here, music playing or not), a share card (QR code, room code, link with Copy link),
// requests waiting for approval, the guests, the settings under plain headings (RoomSettings),
// display screens, and a separate area for the things that cut people off: lock, a new code,
// close the room. Rooms are Premium; other plans see what it is and which plan has it.
//
// Guests and screens show whether they are really here ("Here now", "Away · last seen 5 min
// ago", "Screen 1 · offline since 21:04") from the server's heartbeat, updated by the 3 s poll
// (useVisiblePoll: paused while the tab is hidden, read at once on return); changes are announced
// politely, at most once every 10 s. Every button is an Action, busy until its answer is back;
// Remove, Ban, a new code and closing the room ask first in a ConfirmDialog that says what
// happens, since none of them can be undone.

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Song = { song_id: number; title: string; artist: string; length_s: number };
type Item = { request_id: string; song: Song | null; status: string; votes: number; nickname: string | null };
type Guest = { id: string; nickname: string; status: string; joined_at?: number; last_seen_at?: number; online?: boolean };
type Screen = { id: string; label: string; paired_at: number | null; last_seen_at: number | null; online: boolean };
type Confirm = { title: string; body: string; confirmLabel: string; run: () => Promise<unknown> };
type Settings = RoomSettingsValue;
type Panel = {
  room: { id: string; name: string; status: string; settings: Settings; ends_at: number };
  code: string | null; join_path: string | null; guests: Guest[]; inbox: Item[]; coming_up: Item[]; unfit: Item[];
  renders_left: number; music_paused: boolean; displays: number; screens?: Screen[]; now?: number;
  /** false when the host's browser is the planner: nothing is rendered, so no render count applies */
  renders_apply?: boolean; bounds?: LimitBounds;
};

const POLL_MS = 3000;
const ANNOUNCE_EVERY_MS = 10_000;
const SAID_MS = 2500;
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
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<SettingsGroup | null>(null);
  const fading = useRef({ copied: 0, saved: 0 });
  useEffect(() => () => { window.clearTimeout(fading.current.copied); window.clearTimeout(fading.current.saved); }, []);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState('');
  // cloud.offline_shell: a room lives on the server, so its controls wait for the connection
  const offline = useNeedsConnection();
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
      // the shell's room session (useRoomSession) hears at once that the room opened, changed or ended
      window.dispatchEvent(new Event(ROOM_EVENT));
      return true;
    } catch (problem) { setError((problem as Error).message); return false; }
  };

  if (locked) {
    const plan = `${locked[0]?.toUpperCase()}${locked.slice(1)}`;
    return (
      <section className="room-panel room-card room-invite" aria-labelledby="room-title">
        <h2 id="room-title">Rooms <span className="room-plan">{plan}</span></h2>
        <p className="room-lede">Share a QR code at a party and let guests ask for songs from your library, from their own phones. Rooms are part of {plan}.</p>
      </section>
    );
  }

  if (!loaded) return <section className="room-panel room-card" aria-labelledby="room-title" aria-busy="true"><h2 id="room-title" className="visually-hidden">Room</h2><Skeleton variant="rows" lines={3} label="Loading your room" /></section>;

  if (!panel) {
    const open = () => act('/rooms', { method: 'POST', body: JSON.stringify({ name: name || 'Party', settings: {} }) }, 'Room open.');
    return (
      <section className="room-panel room-card room-invite" aria-labelledby="room-title">
        <h2 id="room-title">Open a room</h2>
        {/* After the room is closed the page comes back here, so the ending is said here, not lost. */}
        {said && <p className="room-said" role="status">{said}</p>}
        <p className="room-lede">Let your guests pick the music. They scan a QR code and ask for songs from your library on their own phones.</p>
        <ul className="room-points">
          <li><Icon name="check" size="compact" /> No app and no account for guests</li>
          <li><Icon name="check" size="compact" /> Nothing plays on their phones</li>
          <li><Icon name="check" size="compact" /> You stay in charge: approve requests, set limits, remove anyone</li>
        </ul>
        {/* one field, so Enter still sends the form; the button is an Action so it shows it's busy */}
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void open(); }} className="room-open">
          <label htmlFor="room-name">Room name guests will see</label>
          <div className="room-row">
            <input id="room-name" value={name} maxLength={40} placeholder="Party" onChange={(event) => setName(event.target.value)} />
            <fieldset className="offline-fieldset" disabled={!!offline}><Action type="button" className="primary" run={open} working={`Opening${ELLIPSIS}`}>Open room</Action></fieldset>
          </div>
        </form>
        {offline && <p className="needs-connection">{offline}</p>}
        {error && <p className="room-error" role="alert">{error}</p>}
      </section>
    );
  }

  const room = panel.room;
  const base = `/rooms/${encodeURIComponent(room.id)}`;
  const link = panel.join_path ? `${origin}${panel.join_path}` : '';
  const host = origin.replace(/^https?:\/\//, '');
  const settings = room.settings;
  const isLocked = room.status === 'locked';
  const save = (change: Partial<Settings>, group: SettingsGroup) => {
    setSaved(null);
    void act(`${base}/settings`, { method: 'PATCH', body: JSON.stringify(change) }).then((ok) => {
      if (!ok) return;
      setSaved(group);
      window.clearTimeout(fading.current.saved);
      fading.current.saved = window.setTimeout(() => setSaved(null), SAID_MS);
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true); setError('');
      window.clearTimeout(fading.current.copied);
      fading.current.copied = window.setTimeout(() => setCopied(false), SAID_MS);
    } catch { setError('Couldn’t copy the link. Select it and copy it yourself.'); }
  };
  const now = panel.now ?? Date.now() / 1000;
  const groups = groupGuests(panel.guests, now);
  const pair = () => act(`${base}/displays`, { method: 'POST', body: JSON.stringify({ pairing_code: pairing }) }, 'Screen paired.').then((ok) => { if (ok) setPairing(''); });
  const screens = panel.screens ?? [];
  const newCode = (removeEveryone: boolean) => setConfirm(removeEveryone ? {
    title: 'Make a new code and remove everyone?',
    body: 'Every guest leaves the room now, and the old QR code and link stop working. Share the new code with the people you want back. Requests already made stay.',
    confirmLabel: 'New code and remove everyone',
    run: () => act(`${base}/code`, { method: 'POST', body: JSON.stringify({ remove_everyone: true }) }, 'New code made and everyone was removed. The old code no longer works.'),
  } : {
    title: 'Make a new code?',
    body: 'The old QR code stops working the moment the new one exists. Guests already here stay.',
    confirmLabel: 'Make a new code',
    run: () => act(`${base}/code`, { method: 'POST', body: JSON.stringify({ remove_everyone: false }) }, 'New code made. The old one no longer works.'),
  });
  const guestRow = (guest: Guest) => (
    <li key={guest.id} data-testid="room-guest" data-presence={guest.online ? 'here' : 'away'}>
      <span className="room-who"><b>{guest.nickname}</b>
        <span className={guest.online ? 'room-presence room-here' : 'room-presence room-muted'} data-testid="room-guest-presence">{guest.status === 'pending' ? 'Waiting to be let in · ' : ''}{guestPresence(guest, now)}</span></span>
      {guest.status === 'pending' && <Action type="button" className="primary" run={() => act(`${base}/guests/${guest.id}/approve`)} aria-label={`Let ${guest.nickname} in`}>Let in</Action>}
      <Menu className="room-guest-menu" title={`Options for ${guest.nickname}`} label={<><Icon name="more" /><VisuallyHidden>Options for {guest.nickname}</VisuallyHidden></>}>
        <MenuItem aria-label={`Remove ${guest.nickname}`} onClick={() => setConfirm({
          title: `Remove ${guest.nickname}?`,
          body: 'They leave the room now and their requests stay. They can scan the code again and join as someone new; to keep them out, ban them instead.',
          confirmLabel: 'Remove',
          run: () => act(`${base}/guests/${guest.id}/remove`, { method: 'POST' }, `${guest.nickname} was removed.`),
        })}>Remove from room</MenuItem>
        <MenuItem danger aria-label={`Ban ${guest.nickname}`} onClick={() => setConfirm({
          title: `Ban ${guest.nickname}?`,
          body: "They can't come back to this room. Their waiting requests are withdrawn and their votes taken back.",
          confirmLabel: 'Ban',
          run: () => act(`${base}/guests/${guest.id}/ban`, { method: 'POST' }, `${guest.nickname} is banned for this room.`),
        })}>Ban from room</MenuItem>
      </Menu></li>
  );
  const approving = settings.request_mode === 'approve' || panel.inbox.length > 0;

  return (
    <section className="room-panel" aria-labelledby="room-title">
      {offline && <p className="needs-connection">{offline}</p>}
      <fieldset className="offline-fieldset" disabled={!!offline}>
      <div className="room-page">
      <header className="room-head">
        <h2 id="room-title">{room.name}</h2>
        <p className="room-status-line">
          <span data-testid="room-status"><Status kind={isLocked ? 'paused' : 'ready'}>{isLocked ? 'Locked: no new guests' : 'Open'}</Status></span>
          <span>{countOf(groups.here.length, 'guest')} here</span>
          <span>{panel.music_paused ? 'Nothing playing' : 'Music playing'}</span>
        </p>
      </header>
      {panel.music_paused && <p className="room-banner">{panel.renders_apply === false
        ? 'Guests can still ask for songs while nothing is playing. Each one reaches your Requests on any page while this browser is open.'
        : `No speaker is playing, so guests see "The music's paused".${playHereOn ? ' Press Play here on a device to start.' : ''}`}</p>}
      {said && <p className="room-said" role="status">{said}</p>}
      <p className="room-sr" role="status" aria-live="polite" data-testid="room-presence-said">{presenceSaid}</p>
      {error && <p className="room-error" role="alert">{error}</p>}

      <div className="room-columns">
        <section className="room-card room-share" aria-labelledby="share-title">
          <h3 id="share-title">Invite guests</h3>
          {link && <div className="room-qr" data-testid="room-qr" data-link={link} dangerouslySetInnerHTML={{ __html: qrSvg(link, `QR code to join ${room.name}`) }} />}
          <div className="room-share-words">
            <p className="room-code-label">Room code</p>
            <p className="room-code" data-testid="room-code">{panel.code}</p>
            {link && (
              <div className="room-link">
                <a href={link} target="_blank" rel="noreferrer" title={link}>{link.replace(/^https?:\/\//, '')}</a>
                <Action type="button" run={copy}>{copied ? <><Icon name="check" size="compact" /> Copied</> : 'Copy link'}</Action>
                <span className="room-sr" role="status">{copied ? 'Link copied.' : ''}</span>
              </div>
            )}
            <p className="room-help">Guests scan the code with their phone camera, or open the link. No app and no account.</p>
            {displayOn && <p className="room-help">For a TV or projector, open {host}/display on it and pair it under Display screens.</p>}
          </div>
        </section>

        <div className="room-stack">
          {approving && (
            <section className="room-card" aria-labelledby="inbox-title">
              <h3 id="inbox-title">Requests waiting for approval ({panel.inbox.length})</h3>
              {panel.inbox.length === 0 ? <p className="room-muted">Nothing waiting. New requests appear here for you to approve or pass.</p> : (
                <ul className="room-list">{panel.inbox.map((item) => (
                  <li key={item.request_id}><span>{songText(item.song)}<span className="room-muted"> · {item.nickname}{votesOn && settings.votes ? ` · ${countOf(item.votes, 'vote')}` : ''}</span></span>
                    <Action type="button" className="primary" run={() => act(`${base}/requests/${item.request_id}/approve`)} aria-label={`Approve ${songText(item.song)}`}>Approve</Action>
                    <Action type="button" run={() => act(`${base}/requests/${item.request_id}/pass`)} aria-label={`Pass on ${songText(item.song)}`}>Pass</Action></li>
                ))}</ul>
              )}
            </section>
          )}
          <section className="room-card" aria-labelledby="coming-title">
            <h3 id="coming-title">Accepted requests ({panel.coming_up.length})</h3>
            {panel.coming_up.length === 0 ? <p className="room-muted">{settings.request_mode === 'off' ? 'Requests are off for this room.' : 'No accepted guest requests yet.'}</p> : (
              <>
                <p className="room-muted">These wait in Request a song on the device that plays the music. Add them to the mix there.</p>
                <ol className="room-list">{panel.coming_up.map((item) => <li key={item.request_id}><span>{songText(item.song)}<span className="room-muted"> · {item.nickname}</span></span></li>)}</ol>
              </>
            )}
            {panel.unfit.length > 0 && (<>
              <h4>Couldn't fit</h4>
              <ul className="room-list">{panel.unfit.map((item) => (
                <li key={item.request_id}><span>{songText(item.song)}</span><Action type="button" run={() => act(`${base}/requests/${item.request_id}/approve`)}>Try again</Action></li>
              ))}</ul>
            </>)}
            {panel.renders_apply !== false && <p className="room-muted">{countOf(panel.renders_left, 'request render')} left this hour.</p>}
          </section>
          <section className="room-card" aria-labelledby="guests-title">
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
        </div>
      </div>

      <section className="room-card" aria-labelledby="settings-title">
        <h3 id="settings-title">Settings</h3>
        <p className="room-muted">Changes are saved as you make them.</p>
        <RoomSettings settings={settings} bounds={panel.bounds} votesOn={votesOn} saved={saved} save={save} />
        {displayOn && (
          <section className="room-group room-screens" aria-labelledby="screen-title">
            <header className="room-group-head"><h4 id="screen-title">Display screens</h4></header>
            <p className="room-help">Show the QR code and what is playing on a TV or projector. Open {host}/display on it, then type the code it shows here.</p>
            {screens.length > 0 && (
              <ul className="room-list" data-testid="room-screens">{screens.map((screen) => (
                <li key={screen.id} data-testid="room-screen" data-presence={screen.online ? 'online' : 'offline'}>
                  <span className={screen.online ? 'room-here' : 'room-muted'}>{screenPresence(screen)}</span>
                  <Action type="button" run={() => act(`${base}/displays/${encodeURIComponent(screen.id)}`, { method: 'DELETE' }, `${screen.label} disconnected.`)} aria-label={`Disconnect ${screen.label}`}>Disconnect</Action></li>
              ))}</ul>
            )}
            <form className="room-open" onSubmit={(event) => { event.preventDefault(); void pair(); }}>
              <label htmlFor="pairing-code">Code on the screen</label>
              <div className="room-row">
                <input id="pairing-code" value={pairing} maxLength={8} autoComplete="off" onChange={(event) => setPairing(event.target.value)} />
                <Action type="button" run={pair} working={`Pairing${ELLIPSIS}`}>Pair screen</Action>
                {panel.displays > 0 && <Action type="button" run={() => act(`${base}/displays`, { method: 'DELETE' }, 'Screens disconnected.')}>Disconnect screens</Action>}
              </div>
            </form>
          </section>
        )}
      </section>

      <section className="room-card room-danger" aria-labelledby="danger-title">
        <h3 id="danger-title">Lock, new code and closing</h3>
        <ul className="room-danger-list">
          <li>
            <span><b>{isLocked ? 'The room is locked' : 'Lock the room'}</b><span className="room-help">{isLocked ? 'Nobody new can join. Unlock it to let guests in again.' : 'Stops anyone new joining. Guests already here stay.'}</span></span>
            <Action type="button" run={() => act(`${base}/${isLocked ? 'unlock' : 'lock'}`, { method: 'POST' }, isLocked ? 'Room unlocked.' : 'Room locked.')}>{isLocked ? 'Unlock' : 'Lock room'}</Action>
          </li>
          <li>
            <span><b>Make a new code</b><span className="room-help">The old QR code and link stop working. Use it when the code has gone further than you wanted.</span></span>
            <span className="room-row">
              <Action type="button" run={() => newCode(false)}>Make a new code</Action>
              <Action type="button" className="destructive" run={() => newCode(true)}>New code and remove everyone</Action>
            </span>
          </li>
          <li>
            <span><b>Close the room</b><span className="room-help">Ends it for everyone. Requests still waiting are withdrawn.</span></span>
            <Action type="button" className="destructive" run={() => setConfirm({
              title: `Close ${room.name}?`,
              body: 'Everyone leaves, the code stops working and requests still waiting are withdrawn. Songs already in your mix stay. You can open a new room afterwards.',
              confirmLabel: 'Close room',
              run: () => act(`${base}/end`, { method: 'POST' }, 'Room ended.'),
            })}>Close room</Action>
          </li>
        </ul>
      </section>
      </div>
      </fieldset>
      {confirm && (
        <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} destructive
          working={`Working${ELLIPSIS}`} onConfirm={confirm.run} onClose={() => setConfirm(null)} />
      )}
    </section>
  );
}
