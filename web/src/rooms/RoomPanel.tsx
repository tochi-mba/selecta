import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Action, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, ELLIPSIS } from '../ui/format';
import { Icon } from '../ui/Icon';
import { MenuItem, VisuallyHidden } from '../ui/primitives';
import { showProblem, showToast } from '../ui/toasts';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { startMixWith } from '../views/BrowserRequests';
import { playingNow, RequestsContext, stageOf } from '../views/Requests';
import { groupGuests, guestPresence, presenceChanges, screenPresence } from './presence';
import type { LimitBounds } from './RoomLimits';
import { RoomRequests, type RoomRequestsMix } from './RoomRequests';
import { RoomSettings, SettingsSection, type RoomSettingsValue, type SettingsGroup } from './RoomSettings';
import { CopyWords, RoomQrScreen, RoomShare, useCopyLink } from './RoomShare';
import { RoomSocial, type SocialSettings } from './RoomSocial';
import { flagOn } from '../flags';
import { RoomStart } from './RoomStart';
import { noteRoom, ROOM_EVENT, useRoomLive, type RoomAsk, type RoomControl } from './useRoomSession';
import './rooms.css';
import { useNeedsConnection } from '../cloud/connection';
import { NumberRoll } from '../feel/numberRoll';
import { useFeelPart } from './feelHooks';
import { ROOM_REQUEST_EVENT } from '../cloud/localFirstRequests';
import '../cloud/connection.css';

// The host's room page (ADR-0416): a live control room.
//
// - Header: the room's name, Open or Locked, how many guests are here, whether music is playing;
//   Copy link, Show QR full screen, and a menu for the things that cut people off (lock, a new
//   code, close the room), each asked about first.
// - Left: the share card (QR code, room code, link) and the guests, each with a menu to remove
//   or ban them.
// - Right, the heart of the page: the requests (RoomRequests), the same list as the Requests
//   drawer. What needs approval, what is accepted and ready to add to the mix, what was added.
// - Below: settings, saved as they change, with "Saved" beside the group that changed.
//
// Before a room exists the page is RoomStart. Rooms are Premium; other plans see what it is and
// which plan has it. What happened after a press is said in a toast, never in a line that stays
// on the page. Guests and screens show whether they are really here from the server's heartbeat,
// updated by the 3 s poll (paused while the tab is hidden); changes are announced politely.

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Item = RoomAsk & { status: string };
type Guest = { id: string; nickname: string; status: string; joined_at?: number; last_seen_at?: number; online?: boolean };
type Screen = { id: string; label: string; paired_at: number | null; last_seen_at: number | null; online: boolean };
type Confirm = { title: string; body: string; confirmLabel: string; run: () => Promise<unknown> };
type Settings = RoomSettingsValue;
// what a room opened by an older server reads as, until it sends these settings itself
const SOCIAL_DEFAULTS: SocialSettings = {
  keeps: true, reactions: true, rounds: true, round_seconds: 45, round_every_songs: 0, round_auto_add: true, dedications: true, recap: true,
  screen_rounds: true, screen_reactions: true, screen_dedications: true, screen_recap: true,
};
type Panel = {
  room: { id: string; name: string; status: string; settings: Settings; ends_at: number };
  code: string | null; join_path: string | null; guests: Guest[]; inbox: Item[]; coming_up: Item[]; unfit: Item[];
  music_paused: boolean; displays: number; screens?: Screen[]; now?: number;
  /** false when the host adds each accepted request to the mix in this browser */
  renders_apply?: boolean; bounds?: LimitBounds;
};

const POLL_MS = 3000;
const ANNOUNCE_EVERY_MS = 10_000;
const SAID_MS = 2500;
/** How recently a guest joined, in seconds, for their mark to pop in as they appear. */
const JUST_JOINED_S = 15;

export function RoomPanel({ api, workspaceId, locked, votesOn = true, displayOn = true, playHereOn = true, freshOnly = false, origin = window.location.origin }: {
  api: Api; workspaceId: string; locked?: string; votesOn?: boolean; displayOn?: boolean; playHereOn?: boolean; origin?: string;
  /** ADR-0422 (rooms.nickname_confirm): a poll that overlapped one of the host's own changes is dropped. */
  freshOnly?: boolean;
}) {
  // ADR-0422: bumped when a host change goes out and when it's answered; a poll that saw either is stale.
  const hostChanges = useRef(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pairing, setPairing] = useState('');
  const [saved, setSaved] = useState<SettingsGroup | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // ADR-0477: the room was opened from this page, so its code arrives as a moment and its status pings once
  const [justOpened, setJustOpened] = useState(false);
  const moving = useFeelPart('motion');
  const moments = useFeelPart('moments');
  const savedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // cloud.offline_shell: a room lives on the server, so its controls wait for the connection
  const offline = useNeedsConnection();
  const [presenceSaid, setPresenceSaid] = useState('');
  const seen = useRef<{ guests: Guest[]; screens: Screen[] } | null>(null);
  const queued = useRef<string[]>([]);
  const lastAnnounced = useRef(0);
  const announceTimer = useRef(0);
  // the browser's own Requests list, where this shell has one: its rows add a request to the mix
  const requests = useContext(RequestsContext);
  const shown = useRoomLive();
  const requestsError = requests?.error ?? '';
  useEffect(() => { if (requestsError) showProblem(requestsError); }, [requestsError]);

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
      setPanel(answer.room); setLoaded(true); setLoadError('');
      // the Requests drawer and this page list the same requests from this one read
      noteRoom(answer.room);
    } catch (problem) { setLoadError((problem as Error).message || 'Check your connection.'); setLoaded(true); }
  }, [api, workspaceId, freshOnly]);
  // A plan without Rooms still reads the current room: a host who downgraded mid-party keeps the
  // room that is open until it ends (the server lets every route after opening through)
  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, POLL_MS, !locked || !!panel);

  const act = async (path: string, init: RequestInit = { method: 'POST' }, success = '') => {
    hostChanges.current += 1;
    try {
      const next = await api<Panel>(path, init, workspaceId);
      hostChanges.current += 1;
      const ended = next.room.status === 'ended';
      setPanel(ended ? null : next);
      noteRoom(ended ? null : next);
      if (success) showToast(success);
      // the shell's room session (useRoomSession) hears at once that the room opened, changed or ended
      window.dispatchEvent(new Event(ROOM_EVENT));
      return true;
    } catch (problem) { showProblem((problem as Error).message || 'That didn’t work. Try again.'); return false; }
  };

  const link = panel?.join_path ? `${origin}${panel.join_path}` : '';
  const { copied, copy } = useCopyLink(link, showProblem);

  if (locked && !panel) {
    const plan = `${locked[0]?.toUpperCase()}${locked.slice(1)}`;
    return (
      <section className="room-panel room-card room-invite" aria-labelledby="room-title">
        <h2 id="room-title">Rooms <span className="room-plan">{plan}</span></h2>
        <p className="room-lede">Share a QR code at a party and let guests ask for songs from your library, from their own phones. Rooms are part of {plan}.</p>
      </section>
    );
  }

  if (!loaded) {
    return (
      <section className="room-panel" aria-labelledby="room-title" aria-busy="true">
        <h2 id="room-title" className="visually-hidden">Room</h2>
        <div className="room-grid">
          <div className="room-side"><div className="room-card"><Skeleton variant="rows" lines={3} label="Loading your room" /></div></div>
          <div className="room-card room-requests-card" aria-hidden="true"><Skeleton variant="rows" lines={5} label="Loading requests" /></div>
        </div>
      </section>
    );
  }

  if (!panel) {
    if (loadError) return <section className="room-panel" aria-labelledby="room-title"><h2 id="room-title" className="visually-hidden">Room</h2><Problem retry={load}>Couldn’t load your room. {loadError}</Problem></section>;
    return <RoomStart offline={offline ?? ''} open={(name) => act('/rooms', { method: 'POST', body: JSON.stringify({ name, settings: {} }) }, `${name} is open. Share the code to let guests in.`).then((ok) => { if (ok) setJustOpened(true); return ok; })} />;
  }

  const room = panel.room;
  const base = `/rooms/${encodeURIComponent(room.id)}`;
  const host = origin.replace(/^https?:\/\//, '');
  const settings = room.settings;
  const isLocked = room.status === 'locked';
  const save = (change: Partial<Settings>, group: SettingsGroup) => {
    setSaved(null);
    void act(`${base}/settings`, { method: 'PATCH', body: JSON.stringify(change) }).then((ok) => {
      if (!ok) return;
      setSaved(group);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(null), SAID_MS);
    });
  };
  const now = panel.now ?? Date.now() / 1000;
  const groups = groupGuests(panel.guests, now);
  const away = groups.away.length + groups.gone.length;
  const pair = () => act(`${base}/displays`, { method: 'POST', body: JSON.stringify({ pairing_code: pairing }) }, 'Screen paired.').then((ok) => { if (ok) setPairing(''); });
  const screens = panel.screens ?? [];
  const lock = () => act(`${base}/${isLocked ? 'unlock' : 'lock'}`, { method: 'POST' }, isLocked ? 'Room unlocked. New guests can join.' : 'Room locked. Nobody new can join.');
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
  const close = () => setConfirm({
    title: `Close ${room.name}?`,
    body: 'Everyone leaves, the code stops working and requests still waiting are withdrawn. Songs already in your mix stay. You can open a new room afterwards.',
    confirmLabel: 'Close room',
    run: () => act(`${base}/end`, { method: 'POST' }, `${room.name} is closed.`),
  });
  // a guest who joined in the last few seconds (by the server's clock) pops in; nobody else moves
  const joinedNow = (guest: Guest) => moving && guest.joined_at !== undefined && now - guest.joined_at < JUST_JOINED_S;
  const guestRow = (guest: Guest) => (
    <li key={guest.id} data-testid="room-guest" data-presence={guest.online ? 'here' : 'away'}>
      <span className={joinedNow(guest) ? 'ask-face room-face feel-pop' : 'ask-face room-face'} aria-hidden="true">{guest.nickname.trim()[0]?.toUpperCase() ?? '?'}</span>
      <span className="room-who"><b>{guest.nickname}</b>
        <span className={guest.online ? 'room-presence room-here' : 'room-presence room-muted'} data-testid="room-guest-presence">{guest.status === 'pending' ? 'Waiting to be let in · ' : ''}{guestPresence(guest, now)}</span></span>
      {guest.status === 'pending' && <Action type="button" className="primary" run={() => act(`${base}/guests/${guest.id}/approve`, { method: 'POST' }, `${guest.nickname} is in.`)} aria-label={`Let ${guest.nickname} in`}>Let in</Action>}
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
          run: () => act(`${base}/guests/${guest.id}/ban`, { method: 'POST' }, `${guest.nickname} is banned from this room.`),
        })}>Ban from room</MenuItem>
      </Menu></li>
  );

  // The host adds each accepted request in this browser when its Requests list is here and the
  // room hands every request over; otherwise SelectaDJ places them and the page only lists them.
  const hostAdds = !!requests && panel.renders_apply === false;
  const playback = requests?.playback;
  const mix: RoomRequestsMix | null = hostAdds && requests ? {
    rows: requests.requests && requests.requests.map((request) => ({ request, stage: stageOf(request, playback) })),
    live: playingNow(playback) && !!playback?.mix.length,
    onAdd: requests.addAnyway,
    onDismiss: requests.cancel,
    onStart: startMixWith(requests.request, playback, requests.refresh),
    inMix: (songId) => !!playback?.mix.some((item) => item.song_id === songId),
  } : null;
  const control: RoomControl = {
    approve: async (id) => { await act(`${base}/requests/${encodeURIComponent(id)}/approve`); },
    pass: async (id) => { await act(`${base}/requests/${encodeURIComponent(id)}/pass`); },
  };
  const phase = playback?.mix.length ? playback.player.state.phase : 'idle';
  const music = hostAdds ? (phase === 'playing' ? 'Music playing' : phase === 'paused' ? 'Music paused' : 'Nothing playing') : panel.music_paused ? 'Nothing playing' : 'Music playing';
  // the same read the Requests drawer and the side bar count from
  const waiting = shown && shown.id === room.id ? shown.inbox.length + shown.coming.length : panel.inbox.length + panel.coming_up.length;
  const requestMode = settings.request_mode === 'off' ? 'Requests off' : settings.request_mode === 'approve' ? 'You approve each' : 'Accepted automatically';

  return (
    <section className="room-panel room-live" aria-labelledby="room-title">
      {offline && <p className="needs-connection">{offline}</p>}
      {locked && <p className="room-lede" data-testid="room-after-downgrade">Your plan no longer includes Rooms. This room stays open until it ends; opening a new one needs {`${locked[0]?.toUpperCase()}${locked.slice(1)}`}.</p>}
      <fieldset className="offline-fieldset" disabled={!!offline}>
      <div className="room-page">
      <header className="room-head">
        <div className="room-head-main">
          <h2 id="room-title">{room.name}</h2>
          <p className="room-facts">
            <span data-testid="room-status" className={`room-pill ${isLocked ? 'is-locked' : 'is-open'}`} data-ping={justOpened && moments && !isLocked ? '' : undefined}><Status kind={isLocked ? 'paused' : 'ready'}>{isLocked ? 'Locked' : 'Open'}</Status></span>
            <span><Icon name="users" size="compact" /> {moving ? <NumberRoll value={groups.here.length} format={(count) => countOf(count, 'guest')} /> : countOf(groups.here.length, 'guest')} here</span>
            <span><Icon name="music" size="compact" /> {music}</span>
          </p>
        </div>
        <div className="room-head-actions">
          <Action type="button" run={copy}><CopyWords copied={copied}>Copy link</CopyWords></Action>
          <button type="button" onClick={() => setQrOpen(true)}><Icon name="expand" size="toolbar" /> Show QR<span className="room-qr-more"> full screen</span></button>
          <Menu className="room-menu" title="Room options" label={<><Icon name="more" /><VisuallyHidden>Room options</VisuallyHidden></>}>
            <MenuItem onClick={() => void lock()}>{isLocked ? 'Unlock room' : 'Lock room'}</MenuItem>
            <MenuItem onClick={() => newCode(false)}>Make a new code</MenuItem>
            <MenuItem danger onClick={() => newCode(true)}>New code and remove everyone</MenuItem>
            <MenuItem danger onClick={close}>Close room</MenuItem>
          </Menu>
        </div>
      </header>
      {!hostAdds && panel.music_paused && <p className="room-note">Guests see "The music's paused" until a device plays.{playHereOn ? ' Press Play here on a device to start.' : ''}</p>}
      {loadError && <p className="room-note" role="status">Trying to reach your room again{ELLIPSIS}</p>}
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="room-presence-said">{presenceSaid}</p>

      <div className="room-grid">
        <div className="room-side">
          <RoomShare name={room.name} code={panel.code} link={link} copied={copied} copy={copy} onFullScreen={() => setQrOpen(true)} arriving={justOpened} />
          <section className="room-card room-guests" aria-labelledby="guests-title">
            <header className="room-card-head">
              <h3 id="guests-title" data-testid="room-guests-heading">Guests</h3>
              <span className="room-count">{groups.here.length} here{away ? ` · ${away} away` : ''}</span>
            </header>
            {!groups.here.length && !away && (
              <div className="room-empty room-empty-small"><Icon name="users" /><p>No guests yet. They join with the code.</p></div>
            )}
            {(groups.here.length > 0 || groups.away.length > 0) && <ul className="room-list">{[...groups.here, ...groups.away].map(guestRow)}</ul>}
            {groups.gone.length > 0 && (
              <details className="room-gone" data-testid="room-guests-gone">
                <summary>Away for a while ({groups.gone.length})</summary>
                <ul className="room-list">{groups.gone.map(guestRow)}</ul>
              </details>
            )}
          </section>
        </div>

        <section className="room-card room-requests-card" aria-labelledby="requests-title">
          <header className="room-card-head">
            <h3 id="requests-title">Requests</h3>
            {waiting > 0 && <span className="ask-count" data-testid="room-waiting-count">{waiting}</span>}
            <span className="room-count room-mode">{requestMode}</span>
          </header>
          <RoomRequests
            variant="page" mix={mix} control={control} votes={votesOn && settings.votes}
            off={settings.request_mode === 'off'} approving={settings.request_mode === 'approve'}
            unfit={panel.unfit} onRetry={(id) => act(`${base}/requests/${encodeURIComponent(id)}/approve`)}
            onChanged={load} onMissing={() => window.dispatchEvent(new Event(ROOM_REQUEST_EVENT))}
            empty={settings.request_mode === 'off' ? (
              <div className="room-empty"><Icon name="request" size="hero" /><p><b>Requests are off</b></p><p>Guests can see what is playing. Turn requests on in Settings below.</p></div>
            ) : (
              <div className="room-empty">
                <Icon name="request" size="hero" />
                <p><b>No requests yet</b></p>
                <p>Songs your guests ask for appear here, ready to add to your mix.</p>
                <Action type="button" run={copy}><CopyWords copied={copied}>Copy invite link</CopyWords></Action>
              </div>
            )}
          />
        </section>
      </div>

      <section className="room-card" aria-labelledby="settings-title">
        <header className="room-card-head">
          <h3 id="settings-title">Settings</h3>
          <span className="room-count">Saved as you change them</span>
        </header>
        <RoomSettings settings={settings} bounds={panel.bounds} votesOn={votesOn} saved={saved} save={save} locked={isLocked} onLock={lock}>
          {displayOn && (
            <SettingsSection title="Display screens" saved={false} wide>
              <p className="room-help">Show the QR code and what is playing on a TV. Open {host}/display on it, then type its code here.</p>
              {screens.length > 0 && (
                <ul className="room-list" data-testid="room-screens">{screens.map((screen) => (
                  <li key={screen.id} data-testid="room-screen" data-presence={screen.online ? 'online' : 'offline'}>
                    <span className={screen.online ? 'room-who room-here' : 'room-who room-muted'}>{screenPresence(screen)}</span>
                    <Action type="button" run={() => act(`${base}/displays/${encodeURIComponent(screen.id)}`, { method: 'DELETE' }, `${screen.label} disconnected.`)} aria-label={`Disconnect ${screen.label}`}>Disconnect</Action></li>
                ))}</ul>
              )}
              <form className="room-open" onSubmit={(event) => { event.preventDefault(); void pair(); }}>
                <label htmlFor="pairing-code">Code on the screen</label>
                <div className="room-open-row">
                  <input id="pairing-code" value={pairing} maxLength={8} autoComplete="off" onChange={(event) => setPairing(event.target.value)} />
                  <Action type="button" run={pair} working={`Pairing${ELLIPSIS}`}>Pair screen</Action>
                </div>
                {panel.displays > 1 && <Action type="button" className="quiet" run={() => act(`${base}/displays`, { method: 'DELETE' }, 'Screens disconnected.')}>Disconnect all screens</Action>}
              </form>
            </SettingsSection>
          )}
          {/* ADR-0488: what the room does together; each group is absent while its feature is off */}
          <RoomSocial
            api={api} workspaceId={workspaceId} base={base} settings={{ ...SOCIAL_DEFAULTS, ...settings }} screens={displayOn ? panel.displays : 0}
            on={{ keeps: flagOn('rooms.keeps'), reactions: flagOn('rooms.reactions'), rounds: flagOn('rooms.rounds'), dedications: flagOn('rooms.dedications'), recap: flagOn('rooms.recap') }}
            saved={saved === 'together' || saved === 'rounds' || saved === 'screen' ? saved : null} save={save}
            tell={(words, problem) => (problem ? showProblem(words) : showToast(words))}
          />
        </RoomSettings>
      </section>
      </div>
      </fieldset>
      {qrOpen && link && <RoomQrScreen name={room.name} code={panel.code} link={link} onClose={() => setQrOpen(false)} />}
      {confirm && (
        <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} destructive
          working={`Working${ELLIPSIS}`} onConfirm={confirm.run} onClose={() => setConfirm(null)} />
      )}
    </section>
  );
}
