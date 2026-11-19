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
  render: (screen: KioskScreen, view: KioskView, extra: { pairingCode: string | null; timeUnknown: boolean; audible: boolean }) => void;
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
    const key = JSON.stringify([current, effectiveView().now, effectiveView().next, pairingCode, deps.clock.status(), audible]);
    if (key === lastScreenKey) return;
    lastScreenKey = key;
    deps.render(current, effectiveView(), { pairingCode, timeUnknown: deps.clock.status() === 'untrusted', audible });
  }

  // -- playing

  function shouldPlay(): boolean {
    if (!paired || !speaker || sessionPaused) return false;
    if (!(autoplay || tapped)) return false;
    if (deps.clock.status() === 'untrusted') return tapped;
    const d = day().state;
    if (d === 'closed') return false;
    if (!online && !permitValid() && !started) return false;
    return d === 'open';
  }

  function syncPlayback(): void {
    const want = shouldPlay();
    if (want && !started) {
      started = true;
      const untrusted = deps.clock.status() === 'untrusted';
      if (untrusted) deps.audio.player.setVolume(UNTRUSTED_VOLUME);
      deps.audio.player.start(5);
    } else if (!want && started) {
      started = false;
      deps.audio.player.stop();
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
      if (!pairingCode || deps.wallNow() >= pairingExpires) {
        const started = await deps.api.startPairing({ public_key: deps.key.publicKey, machine_id: deps.key.machineId });
        pairingCode = started.code;
        pairingExpires = started.expiresAt ?? deps.wallNow() + 600;
        if (started.serverTime) deps.clock.sync(started.serverTime);
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
      online = true;
      lastSync = deps.wallNow();
      deps.clock.sync(answer.serverTime);
      latest = answer.latest;
      speaker = answer.outcome !== 'refused';
      if (answer.session) {
        sessionPaused = answer.session.state === 'paused';
        if (typeof answer.session.volume === 'number' && deps.clock.status() !== 'untrusted') deps.audio.player.setVolume(answer.session.volume, 2);
      }
      await uploadLog();
    } catch (error) {
      if (isRevoked(error)) await forgetPairing();
      else if (error instanceof KioskCallError && error.status === 0) online = false;
    }
  }

  async function uploadLog(): Promise<void> {
    const pending = deps.log.pending().filter((entry) => entry.kind === 'play');
    if (!pending.length) return;
    try {
      await deps.api.resync(pending);
      deps.log.acknowledge(pending.map((entry) => entry.idempotency_key));
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
        const verdict = signed ? await deps.permits.accept(signed) : { ok: false as const, reason: 'forged' as const };
        permitProblem = verdict.ok ? null : verdict.reason;
        const bundle = held();
        if (bundle) deps.clock.setBundle(bundle.permit.issued_at, bundle.permit.valid_until);
      } else if (typeof manifest.issued_at === 'number' && typeof manifest.valid_until === 'number') {
        deps.clock.setBundle(manifest.issued_at, manifest.valid_until);
      }
      deps.audio.player.setSegments(segments);
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
        deps.audio.player.setSegments(saved.segments as PlayableSegment[]);
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
    }),
    view: () => effectiveView(),
    screen,
    state: () => ({ paired, online, started, tapped, autoplay, speaker, updatingSince, permitProblem }),
  };
}

export type KioskController = ReturnType<typeof createController>;
