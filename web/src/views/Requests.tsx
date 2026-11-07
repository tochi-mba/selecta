import { Icon } from '../ui/Icon';
import { Problem, Skeleton } from '../ui/controls';
import { createContext, Fragment, KeyboardEvent, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, SERVER_FAILED_WORDS, del, get, MixData, MixItem, post, SongRow } from '../api';
import { usePreview } from '../audio/focus';
import { etaWords } from '../lib';
import { SetPlayer } from '../player';
import { operationId } from '../state/async';
import { orderOf } from '../state/readiness';
import { AudioPreview } from '../ui/AudioPreview';

type Stage =
  | 'adding' | 'unavailable' | 'never' | 'in_mix' | 'analysing' | 'no_cues' | 'no_mix'
  | 'waiting' | 'searching' | 'approve' | 'preparing' | 'ready';

type Transition = { from: string; to: string; key: string; status: string; label?: string };

export type RequestRow = {
  id: number; song_id: number; title: string | null; artist: string | null;
  status: string; available: number; reason?: string;
  offer?: string; ready?: boolean; needs_approval?: boolean;
  route?: { id: number; title: string; artist?: string | null }[];
  transitions?: Transition[];
  after_id?: number;
  stage?: Stage; waiting_on?: string; seconds?: number | null; after?: string | null;
  never?: boolean; no_cues?: boolean; declined?: boolean; bridge_choice?: boolean | null;
  saving?: boolean; picked?: number[] | null; behind?: string; bridge_lost?: boolean;
};
type RequestList = { requests: RequestRow[]; settled?: string[] };
export type BridgeOption = {
  best: boolean;
  songs: { id: number; title: string; artist?: string | null; bridge: boolean }[];
  song_ids: number[];
  after_id: number;
  after: string;
  before: string | null;
  words: string;
  transitions: Transition[];
};
export type BridgeSearch = { options: BridgeOption[]; looked_at: number; direct: boolean; unsteady?: boolean };
type Playback = { mix: MixItem[]; player: SetPlayer; onMix: (data: MixData) => void };
type Notify = (message: string, undo?: boolean | (() => Promise<void>)) => void;

const WORKING = new Set<Stage>(['adding', 'preparing', 'ready', 'analysing']);
const CAN_FORCE = new Set<Stage>(['searching', 'no_cues']);
// what a bridge needs: a song Selecta knows its way around, and a mix to lead from
const CAN_BRIDGE = new Set<Stage>(['searching', 'approve', 'preparing', 'waiting']);
const WATCH_MS = 1500;
// what needs you comes first, then what's closest to happening
const GROUP_ORDER: Record<Stage, number> = {
  approve: 0,
  ready: 1,
  preparing: 2,
  analysing: 2,
  adding: 3,
  searching: 3,
  waiting: 3,
  no_mix: 3,
  no_cues: 4,
  never: 4,
  unavailable: 4,
  in_mix: 5,
};
const EXTRA_WORDS: Record<number, string> = { 1: 'one extra song', 2: 'two extra songs', 3: 'three extra songs' };
type RequestGroup = 'choice' | 'coming' | 'preparing' | 'waiting';
const GROUP_WORDS: Record<RequestGroup, { title: string; detail: string }> = {
  choice: { title: 'Needs your choice', detail: 'Nothing joins until you approve or decline the proposed route.' },
  coming: { title: 'Coming up', detail: 'These routes are ready and will join when their guarded position is still valid.' },
  preparing: { title: 'Preparing', detail: 'Selecta is analysing or rendering what these requests need.' },
  waiting: { title: 'Waiting', detail: 'These are still looking for a safe place and are not a promise of strict order.' },
};

function groupOf(stage: Stage): RequestGroup {
  if (stage === 'approve') return 'choice';
  if (stage === 'ready') return 'coming';
  if (stage === 'preparing' || stage === 'analysing' || stage === 'adding') return 'preparing';
  return 'waiting';
}

function playingNow(playback?: Playback): boolean {
  return !!playback && ['playing', 'paused'].includes(playback.player.state.phase);
}

function stageOf(row: RequestRow, playback?: Playback): Stage {
  if (row.saving && row.id < 0) return 'adding';
  if (!row.available) return 'unavailable';
  if (row.never) return 'never';
  if (playback?.mix.some((item) => item.song_id === row.song_id)) return 'in_mix';
  if (row.waiting_on === 'analysis') return 'analysing';
  if (row.no_cues) return 'no_cues';
  if (playback && !playback.mix.length) return 'no_mix';
  if (!playingNow(playback) || !row.stage) return 'waiting';
  // an answer counts from the moment it's given, whatever the last check said
  if (row.stage === 'approve' && row.bridge_choice === true && !row.bridge_lost) return 'preparing';
  if (row.stage === 'approve' && row.bridge_choice === false) return 'searching';
  return row.stage;
}

/** What a request is up to, in the words someone waiting for their song would want. */
export function requestWords(row: RequestRow, stage: Stage): { label: string; tone: string; detail: string } {
  const wait = row.seconds ? ` Ready in ${etaWords(row.seconds)}.` : '';
  const route = row.route ?? [];
  const extras = route.filter((song) => song.id !== row.song_id);
  const extraNames = extras.map((song) => song.title).join(' and ');
  const requested = route.findIndex((song) => song.id === row.song_id);
  const coming = route.slice(0, Math.max(requested, 0)).map((song) => song.title).join(' and ');
  const going = route.slice(requested + 1).map((song) => song.title).join(' and ');
  const leading = [coming && `with ${coming} leading in`, going && `${coming ? 'and' : 'with'} ${going} leading out`].filter(Boolean).join(' ');
  const place = row.after ? `Joins after ${row.after}${leading ? `, ${leading}` : ''}.` : 'A spot has been found.';
  const together = extras.length ? ` They all join together once every transition is ready, and none of them can play before that.` : '';
  switch (stage) {
    case 'adding':
      return { label: 'Adding', tone: 'active', detail: 'Saving your request.' };
    case 'unavailable':
      return { label: 'Needs attention', tone: 'stuck', detail: 'It’s gone from your library, so it can’t join.' };
    case 'never':
      return { label: 'Needs attention', tone: 'stuck', detail: 'You’ve set this song to never play. Change that in your Library and it can join.' };
    case 'in_mix':
      return { label: 'In your mix', tone: 'quiet', detail: 'This song is already in your mix.' };
    case 'analysing':
      return { label: 'Getting ready', tone: 'active', detail: `Selecta needs to listen to it first.${wait}` };
    case 'no_cues':
      return { label: 'Needs attention', tone: 'stuck', detail: 'No lyrics were found for it, so Selecta can’t tell where the singing is and won’t risk cutting off a line.' };
    case 'no_mix':
      return { label: 'Waiting for a mix', tone: 'quiet', detail: 'Start a mix and Selecta will find a spot.' };
    case 'waiting':
      return { label: 'Waiting to play', tone: 'quiet', detail: 'Selecta finds a spot for it while your mix is playing.' };
    case 'searching':
      return {
        label: 'Finding a place',
        tone: 'quiet',
        detail: row.behind
          ? `It would go in the same spot as ${row.behind}, so it’s waiting for that to join first. Then it finds its own.`
          : row.bridge_lost
            ? 'The bridge you chose stopped fitting. Find another, or it keeps looking for a spot where it fits directly.'
            : row.declined || row.bridge_choice === false
              ? 'You said no to an extra song, so it’s waiting for a spot where it fits directly.'
              : 'Nothing fits well yet. It won’t force a bad transition, and it rechecks every time the mix changes.',
      };
    case 'approve':
      return {
        label: 'Needs your choice',
        tone: 'attention',
        detail: `${row.bridge_lost ? 'The bridge you chose stopped fitting. ' : ''}Getting to it takes ${EXTRA_WORDS[extras.length] ?? 'one extra song'}${extraNames ? `: ${extraNames}` : ''}.`,
      };
    case 'preparing':
      return { label: 'Getting ready', tone: 'active', detail: `${place}${together}${wait}` };
    case 'ready':
      return { label: 'Coming up', tone: 'active', detail: place };
  }
}

export type RequestsState = {
  requests: RequestRow[] | null;
  error: string;
  message: string;
  playback?: Playback;
  add: (song: SongRow) => Promise<void>;
  cancel: (request: RequestRow) => Promise<void>;
  chooseBridge: (request: RequestRow, allow: boolean) => Promise<void>;
  addAnyway: (request: RequestRow) => Promise<void>;
  findBridges: (request: RequestRow) => Promise<BridgeSearch>;
  pickBridge: (request: RequestRow, option: BridgeOption) => Promise<void>;
};

export const RequestsContext = createContext<RequestsState | null>(null);

/** Requests stay separate from the playing order until a safe place is ready. This keeps watching
 * for one on every page, while the panel only shows on the pages where it's useful. Everything a
 * person presses shows straight away and is put right if the server says no. */
export function useRequests(playback?: Playback, notify?: Notify): RequestsState {
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const latest = useRef(playback);
  latest.current = playback;
  const told = useRef(notify);
  told.current = notify;
  // a list that was asked for before someone pressed something is out of date when it arrives
  const changes = useRef(0);
  const inFlight = useRef(0);
  const nextTemporaryId = useRef(-1);
  const addingNow = useRef(new Set<number>());
  const requestOperations = useRef(new Map<number, string>());
  const leaving = useRef(new Set<number>());
  const bridgeAnswers = useRef(new Map<number, { line: Promise<unknown>; newest: string; going: number }>());
  const checkNow = useRef<() => void>(() => {});

  const playbackBody = () => {
    const active = latest.current;
    if (!active) return null;
    const now = active.player.state;
    if (!['playing', 'paused'].includes(now.phase) || now.inSeam || now.duration - now.songTime < 8) return null;
    return { order: active.mix.map((item) => item.song_id), position: now.position,
      phase: now.phase, seconds_left: now.duration - now.songTime };
  };

  /** A press: show it now, send it, and put back only what this press changed if it fails. */
  const press = async <T,>(
    show: (rows: RequestRow[]) => RequestRow[],
    undo: (rows: RequestRow[]) => RequestRow[],
    send: () => Promise<T>,
    failed: string,
  ): Promise<T | null> => {
    changes.current += 1;
    inFlight.current += 1;
    setError('');
    setMessage('');
    setRequests((rows) => show(rows ?? []));
    try {
      return await send();
    } catch (problem) {
      const words = (problem as Error).message;
      setRequests((rows) => undo(rows ?? []));
      setError(words && !['Not Found', SERVER_FAILED_WORDS].includes(words) ? words : failed);
      return null;
    } finally {
      inFlight.current -= 1;
      changes.current += 1;
      // what was just pressed may change everything, so nothing waits for the next regular check
      if (!inFlight.current) checkNow.current();
    }
  };

  /** The server's list, without losing presses it hasn't heard about yet. */
  const settle = (list: RequestRow[], own?: number) => {
    setRequests((rows) => {
      const saving = (rows ?? []).filter((row) => row.id < 0 && row.id !== own && !list.some((fresh) => fresh.song_id === row.song_id));
      const kept = list.filter((fresh) => !leaving.current.has(fresh.id));
      return [...kept.map((fresh) => ({ ...rows?.find((old) => old.id === fresh.id), ...fresh })), ...saving];
    });
  };

  useEffect(() => {
    if (!playback) return;
    let live = true;
    let working = false;
    let again = false;
    const consider = async () => {
      // A hidden tab is not the active listener. It must not autonomously
      // change the current mix based on an audio position no one can hear.
      if (document.visibilityState === 'hidden') return;
      // a check already under way was for how things were, so one more follows it
      if (working) { again = true; return; }
      const body = playbackBody();
      if (!body || inFlight.current) return;
      working = true;
      again = false;
      const seen = changes.current;
      try {
        const data = await post<RequestList>('/requests/consider', body);
        if (!live || seen !== changes.current) return;
        setRequests(data.requests.filter((request) => !leaving.current.has(request.id)));
        if (data.settled?.length) told.current?.(`${data.settled.join(' and ')} is in your mix now, so that request is done.`);
        const ready = data.requests.find((request) => request.ready && request.offer);
        const fresh = playbackBody();
        if (!ready || !fresh || JSON.stringify(fresh.order) !== JSON.stringify(body.order)) return;
        // Use the current audio position after planning, which may have taken several seconds.
        // sent once, whatever happens to the answer, so it can't join twice
        const changed = await post<MixData>('/requests/insert', { ...fresh, offer: ready.offer }, { 'x-operation-id': `join-${ready.offer}` });
        if (!live) return;
        latest.current?.onMix(changed);
        const words = `${ready.title ?? 'Your request'} joined your mix${ready.after ? ` after ${ready.after}` : ''}.`;
        setMessage(words);
        // only while the mix is as this left it, because Undo takes back whatever is newest
        const joined = orderOf(changed.mix);
        told.current?.(words, async () => {
          const before = await post<MixData>('/mix/undo', undefined, { 'x-mix-order': joined });
          latest.current?.onMix(before);
        });
        changes.current += 1;
        setRequests((previous) => previous?.filter((request) => request.id !== ready.id) ?? []);
      } catch {
        // A moving playhead, edit or cancellation invalidates a proposal normally.
        // The persisted request remains waiting and is reconsidered on the next pass.
      } finally {
        working = false;
        if (again && live) void consider();
      }
    };
    checkNow.current = () => void consider();
    const timer = window.setInterval(() => void consider(), 5000);
    const visible = () => {
      if (document.visibilityState === 'visible') void consider();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      checkNow.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [!!playback]);

  // every request is looked at again as soon as anything changes that could affect where it goes
  const mixNow = playback?.mix.map((item) => `${item.song_id}:${JSON.stringify(item.seam?.settings ?? null)}`).join('|');
  const playerNow = playback?.player.state;
  useEffect(() => { checkNow.current(); }, [mixNow, playerNow?.position, playerNow?.phase, playerNow?.inSeam]);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (inFlight.current) return Promise.resolve();
      const seen = changes.current;
      return get<RequestList>('/requests').then((data) => {
        if (!live || seen !== changes.current) return;
        setError((words) => (words.startsWith('Couldn’t load') ? '' : words));
        setRequests((before) => data.requests
          .filter((row) => !leaving.current.has(row.id))
          .map((row) => ({ ...before?.find((old) => old.id === row.id), ...row })));
      }).catch(() => { if (live) setError('Couldn’t load your requests. They’re still saved.'); });
    };
    void refresh();
    const tick = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(tick, 4000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  /** Take a row away for now, and be able to put it back where it was. */
  const removing = (request: RequestRow) => {
    let index = 0;
    return {
      show: (rows: RequestRow[]) => {
        index = rows.findIndex((row) => row.id === request.id);
        leaving.current.add(request.id);
        return rows.filter((row) => row.id !== request.id);
      },
      undo: (rows: RequestRow[]) => {
        leaving.current.delete(request.id);
        if (rows.some((row) => row.id === request.id)) return rows;
        const back = [...rows];
        back.splice(Math.max(index, 0), 0, request);
        return back;
      },
    };
  };

  const add = async (song: SongRow) => {
    // Two presses in the same frame must not create duplicate optimistic rows.
    // If a response was lost, retry using the same server operation identity.
    if (addingNow.current.has(song.id)) return;
    addingNow.current.add(song.id);
    const operation = requestOperations.current.get(song.id) ?? operationId(`request-${song.id}`);
    requestOperations.current.set(song.id, operation);
    const id = nextTemporaryId.current;
    nextTemporaryId.current -= 1;
    const row: RequestRow = { id, song_id: song.id, title: song.title, artist: song.artist, status: 'waiting', available: 1, saving: true };
    try {
      const data = await press(
        (rows) => [...rows, row],
        (rows) => rows.filter((other) => other.id !== id),
        () => post<RequestList>('/requests', { song_id: song.id }, { 'x-operation-id': operation })
          .catch((error) => {
            if (error instanceof ApiError && error.status < 500) requestOperations.current.delete(song.id);
            throw error;
          }),
        `Couldn’t save ${song.title ?? 'that request'}. Try again.`,
      );
      if (data) {
        requestOperations.current.delete(song.id);
        settle(data.requests, id);
      }
    } finally {
      addingNow.current.delete(song.id);
    }
  };
  const cancel = async (request: RequestRow) => {
    const { show, undo } = removing(request);
    const data = await press(
      show,
      undo,
      () => del<RequestList & { cancelled?: boolean }>(`/requests/${request.id}`),
      'Couldn’t cancel that. It’s still on the list.',
    );
    if (data?.cancelled === false) setMessage('That one has already joined your mix. You can change it in Edit.');
    if (data) {
      settle(data.requests);
      leaving.current.delete(request.id);
    }
  };
  /** What someone says about a bridge reaches the server one answer at a time, in the order they
   * said it, so the last thing they said is what stands. Saying the same thing twice sends it once,
   * and a change of mind is never dropped: that would leave a bridge they said no to going ahead.
   * An answer they've already taken back by the time its turn comes isn't sent at all. */
  const answerBridge = (request: RequestRow, answer: string, send: () => Promise<RequestList>) => {
    const answers = bridgeAnswers.current;
    const held = answers.get(request.id) ?? { line: Promise.resolve(), newest: '', going: 0 };
    if (held.going && held.newest === answer) return null;
    held.newest = answer;
    held.going += 1;
    answers.set(request.id, held);
    const turn = held.line.then(async (): Promise<RequestList | null> => (held.newest === answer ? send() : null));
    held.line = turn.catch(() => {});
    return () => turn.finally(() => {
      held.going -= 1;
      if (!held.going) answers.delete(request.id);
    });
  };
  const chooseBridge = async (request: RequestRow, allow: boolean) => {
    const turn = answerBridge(request, allow ? 'allow' : 'decline', () => post<RequestList>(
      `/requests/${request.id}/bridge`,
      allow && request.route?.length ? { allow, songs: request.route.map((song) => song.id) } : { allow },
    ));
    if (!turn) return;
    const data = await press(
      (rows) => rows.map((row) => (row.id === request.id ? { ...row, bridge_choice: allow, declined: !allow, seconds: null } : row)),
      (rows) => rows.map((row) => (row.id === request.id ? { ...row, bridge_choice: request.bridge_choice, declined: request.declined, seconds: request.seconds } : row)),
      turn,
      allow ? 'Couldn’t save your OK. Try again.' : 'Couldn’t save that. Try again.',
    );
    if (data) settle(data.requests);
  };
  const whereItsPlaying = () => {
    const active = latest.current;
    const now = active?.player.state;
    return active && now && ['playing', 'paused'].includes(now.phase)
      ? { order: active.mix.map((item) => item.song_id), position: now.position }
      : undefined;
  };
  const findBridges = (request: RequestRow) => post<BridgeSearch>(`/requests/${request.id}/bridges`, whereItsPlaying());
  const pickBridge = async (request: RequestRow, option: BridgeOption) => {
    const turn = answerBridge(request, `pick:${option.song_ids.join(',')}`, () => post<RequestList>(`/requests/${request.id}/bridge`, { allow: true, songs: option.song_ids }));
    if (!turn) return;
    const data = await press(
      (rows) => rows.map((row) => (row.id === request.id
        ? { ...row, bridge_choice: true, declined: false, bridge_lost: false, behind: undefined, picked: option.song_ids, route: option.songs, after: option.after, after_id: option.after_id, transitions: option.transitions, stage: 'preparing' as Stage, seconds: null }
        : row)),
      (rows) => rows.map((row) => (row.id === request.id ? request : row)),
      turn,
      'Couldn’t save that bridge. Try again.',
    );
    if (data) settle(data.requests);
  };
  const addAnyway = async (request: RequestRow) => {
    const active = latest.current;
    const now = active?.player.state;
    const live = active && now && ['playing', 'paused'].includes(now.phase);
    const body = live ? whereItsPlaying() : undefined;
    const { show, undo } = removing(request);
    const data = await press(show, undo, () => post<MixData>(`/requests/${request.id}/add`, body), 'Couldn’t add it. Try again.');
    if (data) {
      leaving.current.delete(request.id);
      active?.onMix(data);
      const joined = orderOf(data.mix);
      told.current?.(`${request.title ?? 'That song'} is in your mix.`, async () => {
        const before = await post<MixData>('/mix/undo', undefined, { 'x-mix-order': joined });
        latest.current?.onMix(before);
      });
    }
  };

  return { requests, error, message, playback, add, cancel, chooseBridge, addAnyway, findBridges, pickBridge };
}

/** The tag on a song a request put in the mix, wherever that song is shown. */
export function RequestTag({ item }: { item: Pick<MixItem, 'from_request'> }) {
  const mark = item.from_request;
  if (!mark) return null;
  return mark.kind === 'bridge'
    ? <span className="request-tag bridge" title="Selecta added this so your request would fit">{mark.for ? `Bridge to ${mark.for}` : 'Bridge to a request'}</span>
    : <span className="request-tag" title="This song is here because it was requested">Requested</span>;
}

function comingAfter(state: RequestsState | null, afterSongId: number): RequestRow[] {
  return (state?.requests ?? []).filter((request) => {
    const stage = stageOf(request, state?.playback);
    return (stage === 'preparing' || stage === 'ready') && request.after_id === afterSongId;
  });
}

/** Is a request about to take over the place right after this song? */
export function useRequestComing(afterSongId: number | undefined): boolean {
  const state = useContext(RequestsContext);
  return afterSongId !== undefined && comingAfter(state, afterSongId).length > 0;
}

const SEAM_WORDS: Record<string, string> = { ready: 'Ready', rendering: 'Rendering…', queued: 'In line', failed: 'Trying another way' };

/** A transition on the way in: faded until it's done, then solid, and ready to hear. */
function ComingSeam({ item }: { item: Transition }) {
  const [hearing, setHearing] = useState(false);
  const done = item.status === 'ready';
  return (
    <li className={`seam coming-seam ${done ? 'done' : ''}`} aria-label={`Transition from ${item.from} into ${item.to}: ${SEAM_WORDS[item.status] ?? 'Waiting'}`}>
      <div className="seam-line">
        <span className="seam-name coming-name">
          <b>{item.label ?? 'Transition'}</b>
          <span className={`pill ${item.status}`}>{SEAM_WORDS[item.status] ?? 'Waiting'}</span>
        </span>
        <span className="seam-visual-caption"><b>{item.from}</b><span>→</span><b>{item.to}</b></span>
        {done && (
          <div className="seam-actions">
            <button onClick={() => setHearing(!hearing)}>{hearing ? 'Hide' : 'Hear it'}</button>
          </div>
        )}
      </div>
      {hearing && done && <AudioPreview autoPlay src={`/api/seams/${item.key}/preview`} label={`${item.from} into ${item.to}`} />}
    </li>
  );
}

/** What's on its way into the mix, shown where it's going. Everything in one of these joins at the
 * same moment, once every transition in it is ready, so it's shown as one thing, with one way to
 * cancel it. Until then nothing in it can play, and the mix carries on as if it weren't there. Each
 * transition goes solid as it finishes, and the whole thing becomes ordinary rows when it joins. */
export function ComingSongs({ afterSongId }: { afterSongId: number }) {
  const state = useContext(RequestsContext);
  const coming = comingAfter(state, afterSongId);
  if (!state || !coming.length) return null;
  const { playback, cancel } = state;
  return (
    <>
      {coming.map((request) => {
        const stage = stageOf(request, playback);
        const songs = request.route?.length ? request.route : [{ id: request.song_id, title: request.title ?? 'Song', artist: request.artist }];
        const seams = request.transitions ?? [];
        const done = seams.filter((seam) => seam.status === 'ready').length;
        const title = request.title ?? 'Your request';
        const wait = request.seconds ? ` · ${etaWords(request.seconds)}` : '';
        const when = seams.length === 1 ? 'this transition is' : seams.length === 2 ? 'both transitions are' : `all ${seams.length} transitions are`;
        return (
          <li className="coming-group" key={request.id}>
            <div className="coming-head">
              <div className="coming-words">
                <b>{songs.length > 1 ? `${title} is on its way, with a bridge` : `${title} is on its way`}</b>
                <span>
                  {songs.length > 1
                    ? `These ${songs.length} songs join together once ${when} ready. None of them can play before that.`
                    : `It joins your mix once ${when} ready. It can’t play before that.`}
                </span>
              </div>
              <span className="coming-progress" role="status">
                {stage === 'ready' ? 'Ready — waiting for a valid opening' : seams.length ? `${done} of ${seams.length} ready${wait}` : `Getting it ready${wait}`}
              </span>
              <button aria-label={`Cancel request for ${title}`} title="Cancel this request" onClick={() => void cancel(request)}>Cancel</button>
            </div>
            <ol className="coming-rows">
              {seams[0] && <ComingSeam item={seams[0]} />}
              {songs.map((song, index) => {
                const bridge = song.id !== request.song_id;
                return (
                  <FragmentRows key={song.id}>
                    <li className="song coming" aria-label={`${song.title}, on its way into the mix. It won’t play until it’s ready.`}>
                      <span className="grip" aria-hidden="true" />
                      <span className="count" aria-hidden="true">·</span>
                      <div className="song-name">
                        <b>{song.title}</b>
                        <span>{song.artist ?? (bridge ? 'Leads into your request' : 'Unknown artist')}</span>
                        <span className={`request-tag ${bridge ? 'bridge' : ''}`}>{bridge ? `Bridge to ${title}` : 'Requested'}</span>
                      </div>
                      <small className="facts">Not playable yet</small>
                    </li>
                    {seams[index + 1] && <ComingSeam item={seams[index + 1]} />}
                  </FragmentRows>
                );
              })}
            </ol>
          </li>
        );
      })}
    </>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Go through the whole library for the best ways to reach a song, and leave the choice to them. */
function BridgeFinder({ request, onClose }: { request: RequestRow; onClose: () => void }) {
  const state = useContext(RequestsContext);
  const [found, setFound] = useState<BridgeSearch | null>(null);
  const [problem, setProblem] = useState('');
  const [hearing, setHearing] = useState<number | null>(null);
  const title = request.title ?? 'that song';
  useEffect(() => {
    let live = true;
    state?.findBridges(request)
      .then((search) => { if (live) setFound(search); })
      .catch((error: Error) => { if (live) setProblem(error.message || 'That search didn’t work. Try again.'); });
    return () => { live = false; };
  }, []);
  if (!state) return null;
  const use = (option: BridgeOption) => {
    onClose();
    void state.pickBridge(request, option);
  };
  return (
    <div className="bridge-finder">
      <div className="bridge-head">
        <b>Bridges to {title}</b>
        <button onClick={onClose}>Close</button>
      </div>
      {!found && !problem && <p className="hint request-searching" role="status">Going through every song in your library for the best way there…</p>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {found && (
        <>
          <p className="hint">
            Checked {found.looked_at} songs. Nothing changes until you choose one.
            {found.direct ? ' It can already go in without a bridge, so this is only if you’d like one.' : ''}
          </p>
          {!found.options.length && (
            <p className="hint">
              {found.unsteady
                ? 'Selecta can’t find a steady enough beat in this song to blend anything into it, so no bridge can help. You can still play it anyway.'
                : 'No song makes a clean way there from this point in the mix. It rechecks every time the mix changes, or you can play it anyway.'}
            </p>
          )}
          <ul className="bridge-options" aria-label={`Bridges to ${title}`}>
            {found.options.map((option, index) => {
              const extras = option.songs.filter((song) => song.bridge);
              return (
                <li key={option.song_ids.join('-')} className={option.best ? 'best' : ''}>
                  <div className="bridge-title">
                    {option.best && <span className="pill request-active">Best match</span>}
                    <b>{extras.map((song) => song.title).join(' and ')}</b>
                    <span>{extras.length > 1 ? `${EXTRA_WORDS[extras.length]} on the way` : extras[0]?.artist ?? 'Unknown artist'}</span>
                  </div>
                  <p className="bridge-chain">
                    <span>{option.after}</span>
                    {option.songs.map((song) => (
                      <span key={song.id} className={song.bridge ? 'bridge-step' : 'bridge-wanted'}> → {song.title}</span>
                    ))}
                    {option.before && <span> → {option.before}</span>}
                  </p>
                  <p className="hint">{option.words}</p>
                  <div className="row wrap">
                    <button className="primary" onClick={() => use(option)}>Use this</button>
                    <button aria-expanded={hearing === index} onClick={() => setHearing(hearing === index ? null : index)}>
                      {hearing === index ? 'Hide transitions' : 'Hear the transitions'}
                    </button>
                  </div>
                  {hearing === index && (
                    <TransitionPreviews request={{ ...request, transitions: option.transitions }} playback={state.playback} />
                  )}
                </li>
              );
            })}
          </ul>
          {(request.picked || request.bridge_choice === true) && (
            <button onClick={() => { onClose(); void state.chooseBridge(request, false); }}>Don’t use a bridge</button>
          )}
        </>
      )}
    </div>
  );
}

/** Hear what you'd be agreeing to. Pressing shows straight away, renders if it has to, and plays by
 * itself as soon as it's ready. */
function TransitionPreviews({ request }: { request: RequestRow; playback?: Playback }) {
  const preview = usePreview();
  const [wanted, setWanted] = useState('');
  const [problem, setProblem] = useState('');
  const transitions = request.transitions ?? [];
  const named = (key: string) => {
    const item = transitions.find((transition) => transition.key === key);
    return item ? `${item.from} into ${item.to}` : 'A transition';
  };
  const hear = async (item: Transition) => {
    setProblem('');
    if (preview.playing === item.key || wanted === item.key) {
      preview.stop();
      setWanted('');
      return;
    }
    if (item.status === 'ready') {
      setWanted('');
      preview.play(item.key, `/api/seams/${item.key}/preview`, named(item.key));
      return;
    }
    preview.stop();
    setWanted(item.key);
    try {
      await post(`/requests/${request.id}/hear`, { keys: [item.key] });
    } catch (error) {
      setWanted('');
      setProblem((error as Error).message);
    }
  };

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = window.setInterval(() => {
      void get<{ status: string; error?: string }>(`/seams/${wanted}`).then((state) => {
        if (!live) return;
        if (state.status === 'ready') {
          setWanted('');
          preview.play(wanted, `/api/seams/${wanted}/preview`, named(wanted));
        } else if (state.status === 'failed') {
          setWanted('');
          setProblem('That transition didn’t work, so Selecta will find another way in.');
        }
      }).catch(() => {});
    }, WATCH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [wanted]);

  if (!transitions.length) return null;
  return (
    <div className="request-previews">
      {transitions.map((item) => (
        <div className="request-preview" key={item.key}>
          <span className="request-pair"><b>{item.from}</b> → <b>{item.to}</b></span>
          <span className={`pill ${item.status}`}>{SEAM_WORDS[item.status] ?? 'Not made yet'}</span>
          <button aria-label={`Hear ${item.from} into ${item.to}`} aria-pressed={preview.playing === item.key} onClick={() => void hear(item)}>
            {preview.playing === item.key ? <><Icon name="stop" /> Stop</> : wanted === item.key ? 'Getting it ready…' : <><Icon name="play" /> Hear</>}
          </button>
        </div>
      ))}
      {(problem || preview.problem) && <p className="warn" role="alert">{problem || preview.problem}</p>}
    </div>
  );
}

/** Ask for a song, and see what each one is waiting for. */
export function RequestsPanel() {
  const state = useContext(RequestsContext);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SongRow[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [finding, setFinding] = useState<number | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const text = query.trim();

  useEffect(() => {
    let live = true;
    setMatches(null);
    setSearchError('');
    setActiveMatch(-1);
    if (!text) return;
    const timer = window.setTimeout(() => {
      void get<SongRow[]>(`/songs?q=${encodeURIComponent(text)}&state=all&limit=20`)
        .then((rows) => { if (live) setMatches(rows); })
        .catch(() => { if (live) { setMatches([]); setSearchError('Search didn’t work. Try again.'); } });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [text, searchAttempt]);

  if (!state) return null;
  const { requests, error, message, playback, add, cancel, chooseBridge, addAnyway } = state;
  const inMix = new Set(playback?.mix.map((item) => item.song_id));
  const waitingIds = new Set(requests?.map((request) => request.song_id));
  const asBridges = new Set(requests?.flatMap((request) => request.picked ?? []));
  const canPick = (song: SongRow) => !inMix.has(song.id) && !waitingIds.has(song.id) && !asBridges.has(song.id);
  const availableMatches = matches?.map((song, index) => canPick(song) ? index : -1).filter((index) => index >= 0) ?? [];
  const orderedRequests = [...(requests ?? [])].sort((a, b) => GROUP_ORDER[stageOf(a, playback)] - GROUP_ORDER[stageOf(b, playback)]);
  // the list stays open, so a few songs can be asked for from one search
  const pick = (song: SongRow) => {
    void add(song);
    box.current?.focus();
  };
  const finish = () => {
    setQuery('');
    box.current?.focus();
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      setActiveMatch(-1);
      return;
    }
    if (availableMatches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const at = availableMatches.indexOf(activeMatch);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveMatch(availableMatches[(at + direction + availableMatches.length) % availableMatches.length]);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = matches?.[activeMatch];
      const first = selected && canPick(selected) ? selected : matches?.find(canPick);
      if (first) pick(first);
    }
  };

  return (
    <section className="requests" aria-label="Song requests">
      <div className="requests-head">
        <h2>Requests</h2>
        {!!requests?.length && <span className="hint">{requests.length} waiting</span>}
      </div>
      <label htmlFor="request-song-search">Request a song</label>
      <div className="request-search">
        <input
          ref={box}
          id="request-song-search"
          className="requests-search"
          // ready to type into with a keyboard, without throwing an on-screen keyboard over a phone's list
          data-autofocus={window.matchMedia?.('(pointer: fine)').matches || undefined}
          value={query}
          aria-label="Request a song"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="request-results"
          aria-expanded={!!text && !!matches?.length}
          aria-activedescendant={activeMatch >= 0 && matches?.[activeMatch] ? `request-option-${matches[activeMatch].id}` : undefined}
          placeholder="Request a song: search your library"
          autoComplete="off"
          onChange={(event) => { setQuery(event.target.value); setActiveMatch(-1); }}
          onKeyDown={keys}
        />
        {text && <button onClick={finish}>Done</button>}
      </div>
      {searchError && <Problem retry={() => setSearchAttempt((value) => value + 1)}>{searchError}</Problem>}
      {text && matches === null && !searchError && <Skeleton variant="library" lines={2} label="Searching your library" />}
      {text && matches && !searchError && matches.length === 0 && <p className="hint">Nothing in your library matches that.</p>}
      {text && !!matches?.length && (
        <ul id="request-results" className="request-results" role="listbox" aria-label="Matching songs">
          {matches.map((song, index) => {
            const already = inMix.has(song.id) ? 'In your mix' : waitingIds.has(song.id) ? 'Requested' : asBridges.has(song.id) ? 'Coming as a bridge' : '';
            const duplicate = matches.some((other) => other.id !== song.id && other.title === song.title && other.artist === song.artist);
            const identity = `${song.title ?? 'Untitled'} — ${song.artist ?? 'Unknown artist'}${duplicate ? ` (song ${song.id})` : ''}`;
            return (
              <li key={song.id} id={`request-option-${song.id}`} role="option" aria-selected={activeMatch === index}>
                <button aria-label={`${identity} — ${already || 'Request'}`} className={already === 'Requested' ? 'picked' : ''} disabled={!!already} onClick={() => pick(song)}>
                  <span className="request-name">
                    <b>{song.title ?? 'Untitled'}</b>
                    <span>{song.artist ?? 'Unknown artist'}{duplicate ? ` · Song ${song.id}` : ''}</span>
                  </span>
                  <small>{already === 'Requested' ? <><Icon name="check" width={14} height={14} /> Requested</> : already || <><Icon name="plus" width={14} height={14} /> Request</>}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="warn" role="alert">{error}</p>}
      {message && <p className="hint" role="status">{message}</p>}
      {requests === null && !error && <p className="hint">Loading your requests…</p>}
      {requests?.length === 0 && !text && (
        <p className="hint">Ask for a song any time. Selecta finds a spot where it fits, without interrupting the mix.</p>
      )}
      {!!requests?.length && (
        <ul className="request-list" aria-label="Your requests">
          {orderedRequests.map((request, index) => {
            const stage = stageOf(request, playback);
            const group = groupOf(stage);
            const previousGroup = index > 0 ? groupOf(stageOf(orderedRequests[index - 1], playback)) : null;
            const words = requestWords(request, stage);
            const title = request.title ?? 'Unavailable song';
            const hasBridge = request.route?.some((song) => song.id !== request.song_id);
            return (
              <Fragment key={request.id}>
                {group !== previousGroup && (
                  <li className="request-group">
                    <h3>{GROUP_WORDS[group].title}</h3>
                    <p>{GROUP_WORDS[group].detail}</p>
                  </li>
                )}
                <li className={`request-row ${words.tone}`} data-stage={stage}>
                <span className="request-name">
                  <b>{title}</b>
                  <span>{request.artist ?? 'Unknown artist'}</span>
                </span>
                <span className={`pill request-${words.tone} ${WORKING.has(stage) ? 'working' : ''}`}>{words.label}</span>
                <button
                  className="request-cancel"
                  disabled={request.id < 0}
                  title="Cancel this request"
                  aria-label={`Cancel request for ${title}`}
                  onClick={() => {
                    void cancel(request);
                    // the row is going, so focus waits somewhere that's staying
                    box.current?.focus();
                  }}
                >
                  <Icon name="close" /> Cancel
                </button>
                <p className="request-detail">{words.detail}</p>
                {stage === 'approve' && (
                  <div className="request-approve" role="group" aria-label={`Approve the route to ${title}`}>
                    <h3>Getting to {title}</h3>
                    <p className="hint">Nothing joins until you say so. These {request.route?.length ?? 0} songs join together once every transition is ready, or none of them do. None of them can play before that.</p>
                    <ol className="bridge-route" aria-label={`Proposed route to ${title}`}>
                      {request.route?.map((song) => (
                        <li key={song.id} className={song.id === request.song_id ? 'bridge-wanted' : 'bridge-step'}>
                          <span>{song.title ?? 'Untitled'}</span>
                          <small className="soft">{song.id === request.song_id ? 'Your request' : `Extra song${song.artist ? `, ${song.artist}` : ''}`}</small>
                        </li>
                      ))}
                    </ol>
                    <TransitionPreviews request={request} playback={playback} />
                    <div className="row wrap">
                      <button className="primary" onClick={() => void chooseBridge(request, true)}>{(request.route?.length ?? 0) > 2 ? `Add all ${request.route?.length}` : 'Add both'}</button>
                      <button onClick={() => void chooseBridge(request, false)}>No, keep waiting</button>
                    </div>
                  </div>
                )}
                {(CAN_BRIDGE.has(stage) || CAN_FORCE.has(stage)) && (
                  <div className="request-force row wrap">
                    {CAN_BRIDGE.has(stage) && (
                      <button
                        aria-expanded={finding === request.id}
                        title="Goes through every song in your library for the best way to reach this one"
                        onClick={() => setFinding(finding === request.id ? null : request.id)}
                      >
                        {stage === 'approve' ? 'See other bridges' : hasBridge ? 'Find a different bridge' : 'Find a bridge'}
                      </button>
                    )}
                    {CAN_FORCE.has(stage) && (
                      <button onClick={() => void addAnyway(request)}>
                        Play it anyway
                      </button>
                    )}
                    {CAN_FORCE.has(stage) && <small className="hint">Play it anyway puts it in soon, and the transition may be rough.</small>}
                  </div>
                )}
                {finding === request.id && CAN_BRIDGE.has(stage) && (
                  <BridgeFinder request={request} onClose={() => setFinding(null)} />
                )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The panel with its own connection, for showing it on its own. */
export function Requests({ playback, notify }: { playback?: Playback; notify?: Notify }) {
  const state = useRequests(playback, notify);
  return (
    <RequestsContext.Provider value={state}>
      <RequestsPanel />
    </RequestsContext.Provider>
  );
}
