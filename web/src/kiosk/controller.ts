// The kiosk's brain (ADR-0445, ADR-0446 kiosk side): pairing, the signed heartbeat every 5 s,
// health every 60 s and on change, the zone view, the saved horizon and its downloads, the
// play-log upload, auto-start after a restart, the wake lock and update windows. It decides the
// screen with `kioskScreen` (state.ts) and hands it to `render`. Everything it touches is
// injected, so tests drive it with fakes and a fake clock.

import type { OfflineClock } from '../business/offline/offlineClock';
import { capFromEstimate, type ZoneCache } from '../business/offline/zoneCache';
import { browserName, isRevoked, KioskCallError, type HealthReport, type KioskApi } from './api';
import type { ZoneAudio } from './audio';
import type { DeviceKey } from './deviceKey';
import { fillCache } from './download';
import { mayPlay, type PermitStore, type SignedBundle } from './permit';
import type { PlayableSegment } from './player';
import type { PlayLog } from './playLog';
import { dayStateAt, markSession, startupAction, type DayState, type Period, type RestartReason } from './startup';
import { kioskScreen, type KioskScreen } from './state';
import { updateDecision, type KioskWorker } from './update';
import type { KioskView } from './view';
import type { WakeController } from './wake';

/** The closing fade (ADR-0444): 20 s, ending at the close in "exact" mode. */
export const CLOSING_FADE_S = 20;
/** Stay open late pressed during a closing fade turns it round over 10 s (ADR-0444). */
export const REVERSE_FADE_S = 10;

/** Whether an "exact" close has begun its fade, and how long the fade has left. */
export function exactClosing(mode: unknown, closeAt: number | null, now: number | null): number | null {
  if (mode !== 'exact' || closeAt === null || now === null) return null;
  const left = closeAt - now;
  return left <= CLOSING_FADE_S ? Math.max(0.05, left) : null;
}

export const HEARTBEAT_MS = 5_000;
export const HEALTH_MS = 60_000;
export const VIEW_MS = 15_000;
export const HORIZON_MS = 60_000;
export const PAIR_POLL_MS = 3_000;
export const UPDATE_CHECK_MS = 30 * 60_000;
/** The volume used when time is unknown and staff tapped to start (a cautious level). */
export const UNTRUSTED_VOLUME = 40;

export type ControllerDeps = {
  api: KioskApi;
  key: DeviceKey;
  cache: ZoneCache;
  clock: OfflineClock;
  audio: ZoneAudio;
  wake: WakeController;
  log: PlayLog;
  worker: KioskWorker | null;
  version: string;
  restart: RestartReason;
  wallNow: () => number;
  render: (screen: KioskScreen, view: KioskView, extra: { pairingCode: string | null; timeUnknown: boolean; audible: boolean; roomCode: string | null; savedHours: number }) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  reload?: () => void;
  /** The signed offline bundle's keys and the held bundle (ADR-0446); absent in some tests. */
  permits?: PermitStore;
  estimate?: () => Promise<{ usage?: number; quota?: number } | null>;
  battery?: () => Promise<{ level: number; charging: boolean } | null>;
};

const PAIRED_KEY = 'selectadj-kiosk-paired';

export function createController(deps: ControllerDeps) {
  const store = deps.storage ?? null;
  const remember = (on: boolean) => {
    try {
      if (on) store?.setItem(PAIRED_KEY, '1');
      else store?.removeItem(PAIRED_KEY);
    } catch {
      // nothing kept
    }
  };
  let paired = (() => {
    try {
      return store?.getItem(PAIRED_KEY) === '1';
    } catch {
      return false;
    }
  })();
  let view: KioskView = {};
  let online = true;
  let pairingCode: string | null = null;
  let pairingExpires = 0;
  let showingCode = false;
  let speaker = true; // the server lets this player be the zone's speaker
  let sessionPaused = false;
  let started = false;
  let tapped = false;
  let autoplay = false;
  let updatingSince: number | null = null;
  let latest: { version: string; urgent: boolean } | null = null;
  let lastSync: number | null = null;
  let lastHealthKey = '';
  let lastScreenKey = '';
  let restartedAt: number | null = deps.restart === 'first_start' ? null : deps.wallNow();
  let healthDue = 0;

  const now = () => deps.clock.now();
  // With a permit store (the real page), offline rules come only from the verified bundle.
  const held = () => deps.permits?.held() ?? null;
  const closedLike = (state: KioskView['state']) => state === 'closed' || state === 'stopped' || state === 'zone_paused' || state === 'empty';
  const day = (): { state: DayState; closeAt: number | null } => {
    const at = now();
    // Online, the server's view decides (it applies close-now, stay-open-late and pauses at once).
    if (online && view.state !== undefined) return { state: closedLike(view.state) ? 'closed' : view.state === 'starting' ? 'warming' : 'open', closeAt: null };
    const periods = deps.permits
      ? held()?.periods
      : (deps.cache.manifest()?.schedule as { periods?: Period[] } | undefined)?.periods;
    if (at === null || !periods) {
      // no schedule saved: follow the last view
      return { state: closedLike(view.state) ? 'closed' : 'open', closeAt: null };
    }
    return dayStateAt(periods, at);
  };
  const closingMode = () => (deps.cache.manifest()?.schedule as { closing_mode?: string } | undefined)?.closing_mode;
  const permitValid = () => {
    const at = now();
    if (deps.permits) {
      const bundle = held();
      if (!bundle) return false;
      return at === null || mayPlay(bundle.permit, at, started ? day().closeAt : null);
    }
    const until = deps.cache.manifest()?.valid_until;
    return typeof until !== 'number' || at === null || at <= until;
  };
  let permitProblem: string | null = null;
  let roomCode: string | null = null;
  const requests = new Map<string, number>(); // request id to the catalogue song it plays
  /** The horizon without songs the content policy now refuses (ADR-0446, from the verified
   * bundle), and without the rendered seams that lead into or out of them. */
  const playable = (segments: PlayableSegment[]): PlayableSegment[] => {
    const refused = new Set(held()?.content?.refused_song_ids ?? []);
    if (!refused.size) return segments;
    const ordered = [...segments].sort((a, b) => a.starts_at - b.starts_at);
    const out = (s: PlayableSegment | undefined) => s !== undefined && s.song_id !== undefined && refused.has(s.song_id);
    return ordered.filter((s, i) => !out(s) && !((s.kind ?? 'song') === 'transition' && (out(ordered[i - 1]) || out(ordered[i + 1]))));
  };
  let checkedFor: string | null = null;

  /** The view the screen uses: the server's when online; offline, the saved schedule decides. */
  function effectiveView(): KioskView {
    if (online) return view;
    const d = day();
    if (d.state === 'closed') return { ...view, state: 'closed' };
    if (!permitValid() && !started) return { ...view, state: 'closed' };
    return { ...view, state: view.state === 'paused' ? 'paused' : 'open' };
  }

  function screen(): KioskScreen {
    const facts = {
      paired,
      audioUnlocked: autoplay || tapped,
      online,
      savedHoursAhead: deps.audio.savedHoursAhead(),
      updatingSince,
      urgentUpdate: latest?.urgent ?? false,
      showingCode,
      now: deps.wallNow() * 1000,
    };
    let current = kioskScreen(effectiveView(), facts);
    // Playing locally beats what an old view says, and nothing saved means "back shortly".
    if (current.kind === 'playing' && deps.audio.player.mode() === 'nothing_saved') current = { kind: 'problem', code: 'K-110' };
    if (deps.clock.status() === 'untrusted' && paired && !tapped) current = { kind: 'needs_tap' };
    return current;
  }

  function draw(): void {
    const current = screen();
    const audible = deps.audio.player.playing();
    const savedHours = Math.round(deps.audio.savedHoursAhead() * 10) / 10;
    const key = JSON.stringify([current, effectiveView().now, effectiveView().next, pairingCode, deps.clock.status(), audible, roomCode, savedHours]);
    if (key === lastScreenKey) return;
    lastScreenKey = key;
    deps.render(current, effectiveView(), { pairingCode, timeUnknown: deps.clock.status() === 'untrusted', audible, roomCode: online ? roomCode : null, savedHours });
  }

  // -- playing

  function shouldPlay(): boolean {
    if (!paired || !speaker || sessionPaused) return false;
    if (!(autoplay || tapped)) return false;
    if (deps.clock.status() === 'untrusted') return tapped;
    const d = day().state;
    if (d === 'closed') return false;
    if (!online && !permitValid() && !started) return false;
    if (exactClosing(closingMode(), day().closeAt, now()) !== null) return false;
    if (online && typeof view.closing_fade_s === 'number') return false; // close now, exact close
    return d === 'open';
  }

  function syncPlayback(): void {
    const want = shouldPlay();
    if (want && !started) {
      started = true;
      const untrusted = deps.clock.status() === 'untrusted';
      if (untrusted) deps.audio.player.setVolume(UNTRUSTED_VOLUME);
      deps.audio.player.start(deps.audio.player.fadingOut() ? REVERSE_FADE_S : 5);
    } else if (!want && started) {
      started = false;
      // At closing time the music fades over 20 s (ending at the close in exact mode); a
      // pause, an unpairing or a refused permit stops within a second.
      // Online, the server says how long a close now (60 s) or an exact close has left.
      const served = online && typeof view.closing_fade_s === 'number' ? Math.max(0.05, view.closing_fade_s) : null;
      const exact = exactClosing(closingMode(), day().closeAt, now());
      deps.audio.player.stop(served ?? exact ?? (day().state === 'closed' ? CLOSING_FADE_S : 1));
    }
    deps.audio.player.setPaused(sessionPaused);
    deps.wake.sync(want);
  }

  // -- the server

  async function forgetPairing(): Promise<void> {
    paired = false;
    remember(false);
    started = false;
    deps.audio.player.stop();
    deps.log.clear();
    // a revoked player gets nothing more and keeps nothing: its saved music goes too
    await deps.cache.setManifest({ zone_id: '', version: '', segments: [] });
    for (const entry of deps.cache.entries()) entry.committed = false;
    deps.cache.setCap(0);
    await deps.cache.enforceCap();
    deps.audio.player.setSegments([]);
    await deps.key.forget();
    deps.permits?.clear();
    deps.api.setNonce(null);
    pairingCode = null;
  }

  async function pairingStep(): Promise<void> {
    try {
      // the code's expiry is server time: a device clock hours out must not renew it every poll
      if (!pairingCode || (deps.clock.now() ?? deps.wallNow()) >= pairingExpires) {
        const started = await deps.api.startPairing({ public_key: deps.key.publicKey, machine_id: deps.key.machineId });
        pairingCode = started.code;
        if (started.serverTime) deps.clock.sync(started.serverTime);
        pairingExpires = started.expiresAt ?? (deps.clock.now() ?? deps.wallNow()) + 600;
      }
      const status = await deps.api.pairingStatus();
      online = true;
      if (status.serverTime) deps.clock.sync(status.serverTime);
      if (status.state === 'paired' || status.state === 'collected') {
        if (status.permitKeys?.length) deps.permits?.pin(status.permitKeys);
        paired = true;
        remember(true);
        pairingCode = null;
        showingCode = false;
        void deps.cache.requestPersistence();
        // start at once: the first check-in, the zone's view and its saved music
        await heartbeat();
        await refreshView();
        await refreshHorizon();
      } else if (status.state === 'expired' || status.state === 'revoked' || status.state === 'unknown') {
        pairingCode = null;
      }
    } catch (error) {
      online = !(error instanceof KioskCallError && error.status === 0);
    }
  }

  function position() {
    const { segment, offsetS } = deps.audio.player.position();
    const state = deps.audio.player.playing() ? 'playing' : sessionPaused ? 'paused' : 'stopped';
    const songIndex = (segment as PlayableSegment | null)?.song_index ?? 0;
    return { song_index: songIndex, offset_ms: Math.max(0, Math.round(offsetS * 1000)), state };
  }

  async function heartbeat(): Promise<void> {
    if (!paired) return;
    try {
      const answer = await deps.api.heartbeat(position());
      // back after an outage: a volume changed meanwhile ramps over 30 s rather than jumping
      const cameBack = !online;
      online = true;
      lastSync = deps.wallNow();
      deps.clock.sync(answer.serverTime);
      latest = answer.latest;
      speaker = answer.outcome !== 'refused';
      if (answer.session) {
        sessionPaused = answer.session.state === 'paused';
        if (typeof answer.session.volume === 'number' && deps.clock.status() !== 'untrusted') deps.audio.player.setVolume(answer.session.volume, cameBack ? 30 : 2);
      }
      await uploadLog(cameBack && speaker);
    } catch (error) {
      if (isRevoked(error)) await forgetPairing();
      else if (error instanceof KioskCallError && error.status === 0) online = false;
    }
  }

  /** Upload everything logged here (plays, fallback hand-offs, local actions). Back after an outage, the player also sends where it is
   * on the plan (not while on the fallback reel), so the server replans the horizon from the
   * device's position: what played is a fact (ADR-0446 resync). */
  async function uploadLog(backFromOutage = false): Promise<void> {
    // plays for the play log, fallback hand-offs and local actions for the device log
    const pending = deps.log.pending();
    const here = backFromOutage && deps.audio.player.mode() === 'horizon' ? position() : null;
    if (!pending.length && !here) return;
    try {
      const answer = await deps.api.resync(pending, here ? { song_index: here.song_index, offset_ms: here.offset_ms } : null);
      deps.log.acknowledge(pending.map((entry) => entry.idempotency_key));
      if (answer.replanned) await refreshHorizon();
    } catch {
      // kept for the next try
    }
  }

  async function refreshView(): Promise<void> {
    if (!paired || !online) return;
    try {
      view = await deps.api.view();
      if (view.state === 'unpaired') await forgetPairing();
    } catch (error) {
      if (isRevoked(error)) await forgetPairing();
      return;
    }
    await rooms();
  }

  /** Guest requests and the on-screen code (ADR-0451), with the view. A request whose turn has
   * come is put into the programme by the server; the horizon is read again so it is saved and
   * played (and checked against the permit's refused songs like every other song). */
  async function rooms(): Promise<void> {
    try {
      const code = await deps.api.screenCode();
      roomCode = code.on ? code.code : null;
    } catch {
      roomCode = null;
    }
    if (!speaker) return;
    try {
      const next = await deps.api.nextRequest();
      if (next && next.local_song_id !== null && !requests.has(next.id)) {
        requests.set(next.id, next.local_song_id);
        if (next.queued) await refreshHorizon();
      }
    } catch {
      // Rooms is off or not reachable: the music carries on without requests
    }
  }

  /** Tell the server a request was played once its song starts here. */
  async function requestsPlayed(): Promise<void> {
    const playing = (deps.audio.player.current() as PlayableSegment | null)?.song_id;
    if (playing === undefined || !deps.audio.player.playing()) return;
    for (const [id, songId] of requests) {
      if (songId !== playing) continue;
      requests.delete(id);
      try {
        await deps.api.requestPlayed(id);
      } catch {
        // marked again next time is harmless; the server only moves approved requests
      }
    }
  }

  async function refreshHorizon(): Promise<void> {
    if (!paired || !online) return;
    try {
      const estimate = deps.estimate ? await deps.estimate() : null;
      const manifest = await deps.api.horizon(estimate?.quota ?? null);
      deps.cache.setCap(capFromEstimate(estimate));
      const segments = manifest.segments as PlayableSegment[];
      await deps.cache.setManifest(manifest);
      if (deps.permits) {
        const signed = (manifest as { offline_bundle?: SignedBundle }).offline_bundle;
        const missing = (manifest as { offline?: boolean }).offline === false ? 'offline_off' : 'missing';
        const verdict = signed ? await deps.permits.accept(signed) : { ok: false as const, reason: missing };
        permitProblem = verdict.ok ? null : verdict.reason;
        const bundle = held();
        if (bundle) deps.clock.setBundle(bundle.permit.issued_at, bundle.permit.valid_until);
      } else if (typeof manifest.issued_at === 'number' && typeof manifest.valid_until === 'number') {
        deps.clock.setBundle(manifest.issued_at, manifest.valid_until);
      }
      deps.audio.player.setSegments(playable(segments));
      await deps.cache.enforceCap();
      void fillCache(deps.cache, { urlFor: (key) => deps.api.segmentUrl(key), online: () => online });
    } catch (error) {
      if (isRevoked(error)) await forgetPairing();
    }
  }

  async function health(force = false): Promise<void> {
    if (!paired) return;
    const level = deps.audio.player.level();
    const state = deps.audio.player.playing() ? 'playing' : sessionPaused ? 'paused' : day().state === 'closed' ? 'closed' : 'stopped';
    const estimate = deps.estimate ? await deps.estimate().catch(() => null) : null;
    const report: HealthReport = {
      kiosk_version: deps.version,
      browser: browserName(),
      audio_context: (['running', 'suspended', 'closed', 'interrupted'].includes(deps.audio.player.contextState()) ? deps.audio.player.contextState() : 'unknown') as HealthReport['audio_context'],
      autoplay_allowed: autoplay,
      wake_lock: deps.wake.held(),
      output_dbfs: level,
      playing_state: state,
      hours_ahead: deps.audio.savedHoursAhead(),
      storage_used_bytes: estimate?.usage ?? null,
      storage_available_bytes: estimate?.quota != null ? Math.max(0, estimate.quota - (estimate.usage ?? 0)) : null,
      network: online ? 'online' : 'offline',
      clock_offset_ms: Math.round(deps.clock.offsetS() * 1000),
      restarted_at: restartedAt,
      restart_reason: restartedAt ? deps.restart : null,
      battery: deps.battery ? await deps.battery().catch(() => null) : null,
    };
    const key = JSON.stringify([report.audio_context, report.autoplay_allowed, report.wake_lock, report.playing_state, report.network]);
    const due = deps.wallNow() * 1000 >= healthDue;
    if (!force && !due && key === lastHealthKey) return;
    if (!online) return;
    try {
      await deps.api.health(report);
      lastHealthKey = key;
      healthDue = deps.wallNow() * 1000 + HEALTH_MS;
      restartedAt = null; // told once
    } catch (error) {
      if (isRevoked(error)) await forgetPairing();
    }
  }

  async function maybeUpdate(): Promise<void> {
    if (!deps.worker || !latest || latest.version === deps.version) return;
    if (!deps.worker.ready()) {
      if (checkedFor !== latest.version) {
        checkedFor = latest.version; // one background fetch per new version
        deps.worker.check();
      }
      return;
    }
    const segment = deps.audio.player.position();
    const atFadeBoundary = !segment.segment || segment.offsetS < 1;
    const decision = updateDecision({ running: deps.version, latest, day: day().state, atFadeBoundary, ready: deps.worker.ready() });
    if (!decision.activate || updatingSince !== null) return;
    updatingSince = deps.wallNow() * 1000;
    draw();
    if (decision.urgent) deps.log.add({ kind: 'urgent_update', idempotency_key: `urgent-update:${latest.version}`, started_at: deps.wallNow(), recorded_at: deps.wallNow() });
    const ok = await deps.worker.activate();
    if (ok) {
      markSession('update', store);
      deps.reload?.();
    } else {
      updatingSince = null; // keep the old version and say so in health
    }
  }

  return {
    async boot(): Promise<void> {
      await deps.cache.load();
      const saved = deps.cache.manifest();
      if (saved) {
        deps.audio.player.setSegments(playable(saved.segments as PlayableSegment[]));
        const bundle = saved as { issued_at?: number; valid_until?: number };
        const verified = held();
        if (verified) deps.clock.setBundle(verified.permit.issued_at, verified.permit.valid_until);
        else if (!deps.permits && typeof bundle.issued_at === 'number' && typeof bundle.valid_until === 'number') deps.clock.setBundle(bundle.issued_at, bundle.valid_until);
      }
      autoplay = await deps.audio.unlock();
      if (paired) await heartbeat();
      else await pairingStep();
      await refreshView();
      await refreshHorizon();
      const action = startupAction({ paired, clock: deps.clock.status(), day: day().state, autoplayAllowed: autoplay });
      if (action.kind === 'resume') syncPlayback();
      await health(true);
      draw();
    },
    /** One step of every loop that is due; the entry calls it on timers. */
    async every(kind: 'heartbeat' | 'view' | 'horizon' | 'health' | 'update' | 'tick'): Promise<void> {
      if (kind === 'heartbeat') {
        if (paired) await heartbeat();
        if (!paired || showingCode) await pairingStep();
      } else if (kind === 'view') await refreshView();
      else if (kind === 'horizon') await refreshHorizon();
      else if (kind === 'health') await health(true);
      else if (kind === 'update') await maybeUpdate();
      else {
        syncPlayback();
        await deps.audio.player.tick();
        await health(false);
        if (online && requests.size) await requestsPlayed();
        // a newer version is known: fetch it in the background, apply it only when allowed
        if (latest && latest.version !== deps.version) await maybeUpdate();
      }
      draw();
    },
    /** Staff tapped Tap to start: one tap lasts for the page's life. */
    async tap(): Promise<void> {
      tapped = (await deps.audio.unlock()) || true;
      syncPlayback();
      draw();
    },
    showCode(on = true) {
      showingCode = on;
      if (on) pairingCode = null;
      draw();
    },
    panelInfo: () => ({
      deviceName: view.device_name ?? 'Player',
      zone: view.zone_name ?? '',
      network: online ? 'online' as const : 'offline' as const,
      savedHours: deps.audio.savedHoursAhead(),
      lastSync: lastSync === null ? null : lastSync * 1000,
      version: deps.version,
      // a browser without Ed25519 can't check the offline permit: it plays only while connected
      offline: permitProblem === 'unsupported' ? 'newer' as const : permitProblem === 'offline_off' ? 'off' as const : held() ? 'ready' as const : 'not_yet' as const,
    }),
    view: () => effectiveView(),
    screen,
    state: () => ({ paired, online, started, tapped, autoplay, speaker, updatingSince, permitProblem }),
  };
}

export type KioskController = ReturnType<typeof createController>;
