import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixItem } from '../api';
import * as provider from '../dsp/seamProvider';
import { LOAD_NEXT_WITHIN } from '../engine/scheduler';
import { createLevels, type Levels } from '../engine/level';
import { browserMovesAllowed, browserMovesOn, browserStemMovesAllowed } from './browserMoves';
import { flagOn } from '../flags';
import { isOnline } from './connection';
import { armCrashGuard, disarmCrashGuard, spawnStemsWorker, STEM_MODEL_ARTEFACT, StemPrefetcher, stemWindow, workerSeparator, type Observable, type PrefetchState } from '../dsp/stems';
import type { StemReading } from '../dsp/stemSchedule';
import { stemsFlagOn, stemsLicenceHold } from './stems/flag';
import type { MusicSource, SeamRecord, SeamSettingsLike } from '../dsp/seamProvider';

/** A scheduled seam and the two songs (by id) it joined when it was planned. */
export type PlayedRecord = SeamRecord & { pair?: readonly [number | null, number | null] };
import { playbackStatusText, type PlaybackStatus } from '../copy';
import { Api, extrapolate, levelOf, Position, SessionView, StartAt, usePlaybackDevice } from '../devices/usePlaybackDevice';
import { createEngine, type BrowserSpeaker, type Engine, type EngineState } from '../engine';
import { workerCalibrationState, type WorkerCalibration } from '../dsp/budget';
import { mediaDeviceId } from './ConnectMusic';
import type { MediaResolver } from '../media';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { tabLog } from '../devices/audioTab';
import type { SchedulerClock } from '../engine/scheduler';
import { seamShown } from './blendState';
import { handoffWatcher, noteHandoffHeard, pageOnScreen } from '../audio/handoffHeard';
import { saveSongLength } from './songLength';
import { accountSeamPlanner, type AccountSeamAnswer, type AccountSeamAsk } from './accountSeams';
import { deviceRenderOn, type StudioSong } from './deviceStudio';
import { makeDeviceStudio } from './studioWiring';
import { CloudSeams, cloudPairsOf, cloudSeamsOn, withCloudSeams, type CloudPair } from './cloudSeams';
import { browserConnection } from './studioPlan';

/** The shell player for local-first Cloud (ADR-0462 BF-0462-06): the browser engine's speaker
 * (ADR-0457 BrowserSpeaker) driven through the ADR-0415 playback session (usePlaybackDevice),
 * presented as the same PlayerLike the local shell and views already use.
 *
 * Truth rules, all from ADR-0457/0460/0461:
 * - `phase` 'playing' only when this device's engine is playing, or the server says another device
 *   is and its lease is fresh. A lapsed lease (`state_confidence` uncertain) is never 'playing'.
 * - `notice` carries the one status vocabulary (copy.ts); a passing probe or a running graph never
 *   claims audible sound, only a person's sound-check confirmation does.
 * - The spectrum and the visualizer taps come from the engine's analyser as a read-only side
 *   branch (ADR-0477), and only while this device makes the sound; otherwise they are null.
 * - Planned transitions (BF-0459-04): the speaker gets a seam provider (dsp/seamProvider.ts) that
 *   scripts each seam from the mix's seam settings and this device's capability record; the
 *   state's `nextReady`/`seamAt`/`inSeam` come from the schedule actually handed to the
 *   scheduler, never from a wish.
 */

export const NOTHING_TO_PLAY = 'Nothing to play yet. Connect your music and make a mix first.';

/** Everything the player's state is worked out from. */
export type PlayerFacts = {
  mix: readonly Pick<MixItem, 'duration'>[];
  view: SessionView | null;
  /** This device holds the lease and its speaker is running (usePlaybackDevice.isSpeaker). */
  speaking: boolean;
  /** Where this device's engine is, by its audio clock; null when it is not playing here. */
  here: Position | null;
  engine: EngineState | null;
  /** Why this device cannot play (the capability probe or the browser refused), or null. */
  refusal: string | null;
  serverNow: number;
  /** A sentence about the last action, which wins over the status words while it is fresh. */
  said: string;
  /** The seam most recently scheduled on this device's engine, if any. */
  seam?: SeamRecord | null;
  /** Every seam planned this visit, newest last, so a hand-over can be matched to its plan. */
  seams?: readonly SeamRecord[];
  /** The engine's own account of its hand-overs (engine/scheduler.ts clock()), while it plays
   * here. With it, Listen follows the hand-over that really plays (blendState.ts). */
  clock?: SchedulerClock | null;
  /** cloud.offline_playback: a volume (0 to 100) set here while offline, which wins over the
   * session's last word until it has been sent. */
  heldVolume?: number | null;
};

/** The one-vocabulary status for these facts (copy.ts), or null when nothing is playing. */
export function statusOf(facts: PlayerFacts): PlaybackStatus | null {
  if (facts.refusal) return { state: 'unsupported_here', reason: facts.refusal };
  const session = facts.view?.session ?? null;
  if (!facts.speaking) {
    if (session?.state === 'playing' && session.state_confidence === 'uncertain') return { state: 'uncertain' };
    return null;
  }
  const output = facts.engine?.output;
  if (!output) return { state: 'output_unverified' };
  if (output.status === 'verified_at') return { state: 'playing', verifiedAt: output.at };
  return { state: output.status };
}

/** The NowState these facts truthfully support. Pure, so the truth rules are testable. */
export function nowStateFrom(facts: PlayerFacts, sound: { volume: number; muted: boolean }): NowState {
  const session = facts.view?.session ?? null;
  const elsewhere = !facts.speaking && facts.view?.speaker === 'elsewhere';
  let phase: NowState['phase'] = 'idle';
  if (facts.speaking) {
    phase = facts.engine?.phase ?? 'loading';
  } else if (elsewhere && session && session.state_confidence !== 'uncertain') {
    phase = session.state === 'playing' ? 'playing' : session.state === 'paused' ? 'paused' : 'idle';
  }
  const engineHere = facts.speaking && facts.here;
  // a session left on a song past the end of this mix (an older, longer mix) points at nothing:
  // it reads as this mix's start, never as an "Untitled" last song
  const remembered = session?.song_index ?? 0;
  const stale = !engineHere && facts.mix.length > 0 && remembered >= facts.mix.length;
  const position = engineHere ? facts.here!.song_index : stale ? 0 : remembered;
  const offsetMs = engineHere
    ? facts.here!.offset_ms
    : session && phase !== 'idle' && !stale ? extrapolate(session, facts.serverNow) : 0;
  const status = statusOf(facts);
  const words = status ? playbackStatusText(status) : '';
  // only a schedule this device's engine was handed, out of the song playing here, counts
  const seam = facts.speaking && facts.seam && facts.seam.fromIndex === position ? facts.seam.schedule : null;
  const songTime = offsetMs / 1000;
  const level = facts.heldVolume ?? facts.view?.session?.volume;
  const shown = engineHere && facts.clock
    ? seamShown({ position, songTime }, (index) => facts.mix[index]?.duration ?? 0, facts.seams ?? (facts.seam ? [facts.seam] : []), facts.clock)
    : {
      position,
      songTime,
      duration: facts.mix[position]?.duration ?? 0,
      inSeam: !!seam && songTime >= seam.startSeconds && songTime < seam.startSeconds + seam.windowSeconds,
      seamAt: seam ? seam.startSeconds : null,
      nextReady: !!seam,
      blend: null,
    };
  return {
    phase,
    position: shown.position,
    songTime: shown.songTime,
    duration: shown.duration,
    inSeam: shown.inSeam,
    seamAt: shown.seamAt,
    notice: facts.said || facts.engine?.notice || words,
    nextReady: shown.nextReady,
    lastSeamKey: null,
    volume: level == null ? sound.volume : Math.max(0, Math.min(1, level / 100)),
    muted: level === 0 || sound.muted,
    ...(shown.blend ? { blend: shown.blend } : {}),
  };
}

/** What the player can ask of the device session and the engine. */
export type PlayerActions = {
  /** Make this device the speaker (from a press); resolves with a sentence when it could not. */
  /** `insist`: the person chose this device over the one playing (Play here instead): take over
   * from whichever device the session names now, without asking again. */
  playHere(startAt?: StartAt, insist?: boolean | 'free'): Promise<string>;
  command(name: 'play' | 'pause' | 'skip' | 'seek' | 'set_volume', args?: Record<string, unknown>): Promise<void>;
  /** Whether remote commands work; when off, this device steers its own speaker directly. */
  remoteControl: boolean;
  speaker: BrowserSpeaker | null;
};

/** A volume slider moves many times in one drag: the last level is sent once it is still. */
export const VOLUME_SETTLE_MS = 300;
/** How long a level chosen here stands in for the session's while the session catches up. */
export const VOLUME_HOLD_MS = 5000;

export class LocalFirstPlayer implements PlayerLike {
  state: NowState;
  onChange: (state: NowState) => void = () => {};
  private facts: PlayerFacts;
  private actions: PlayerActions;
  private sound = { volume: 1, muted: false, lastAudibleVolume: 1 };
  /** A level set here that the session has not said back yet (0 to 1), and when to stop waiting
   * for it. While it stands, the session's older volume does not replace what the person chose. */
  private chosen: { level: number; until: number } | null = null;
  private volumeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(facts: PlayerFacts, actions: PlayerActions) {
    this.facts = facts;
    this.actions = actions;
    this.state = nowStateFrom(facts, this.sound);
  }

  /** New facts or actions from the host; tells the listener only when the state really moved. */
  update(facts: PlayerFacts, actions: PlayerActions) {
    // what the last press said stays until the next press replaces it
    this.facts = { ...facts, said: this.facts.said };
    this.actions = actions;
    // ADR-0475 G1: the session's level is the one truth (the comfortable default until someone
    // sets one). This player sends a level only when the person moves its own slider; it never
    // pushes its local value over one a remote set, and leaves applying it to the speaker's
    // follow (which rises from quiet on a new speaker), so the two never fight.
    const sessionVolume = facts.heldVolume ?? (facts.view?.session ? levelOf(facts.view.session) : null);
    // the session has caught up with the level chosen here, or never will: it speaks again
    if (this.chosen && (sessionVolume === Math.round(this.chosen.level * 100) || Date.now() >= this.chosen.until)) this.chosen = null;
    if (!this.chosen && typeof sessionVolume === 'number' && Number.isFinite(sessionVolume)) {
      this.sound.volume = Math.max(0, Math.min(1, sessionVolume / 100));
      this.sound.muted = this.sound.volume === 0;
      if (!this.sound.muted) this.sound.lastAudibleVolume = this.sound.volume;
    }
    this.publish();
    this.landJump();
  }

  /** The song a "jump to the transition" is waiting on, until its seam has been scheduled. */
  private jumping: number | null = null;

  /** Once the engine has scheduled the seam out of the song a jump was asked in, land a few
   * seconds before it, so the jump plays the transition as local mode's does. */
  private landJump() {
    if (this.jumping === null) return;
    const seam = this.state.seamAt;
    if (this.state.position !== this.jumping) { this.jumping = null; return; }
    if (seam === null) return;
    this.jumping = null;
    if (this.state.songTime < seam - JUMP_LEAD_SECONDS) void this.seekTo(this.state.position, Math.max(0, seam - JUMP_LEAD_SECONDS));
  }

  private publish(said?: string) {
    if (said !== undefined) this.facts = { ...this.facts, said };
    const next = nowStateFrom(this.shownFacts(), this.sound);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    // The render loop must never be the clock: a publish re-renders the host, the host's
    // effect updates this player, and time has moved a little, so publishing on time alone
    // would feed setState back into render until React trips its update depth. Below the
    // clock step, time drift stays unpublished; tick() advances it at a bounded rate.
    const timeless = (state: NowState) => JSON.stringify({ ...state, songTime: 0 });
    if (timeless(next) === timeless(this.state) && Math.abs(next.songTime - this.state.songTime) < 0.2) return;
    this.state = next;
    // read only: says a hand-over played to its end here, on screen, once it has (T-20261125-ebda)
    this.heard({ phase: this.facts.speaking ? next.phase : 'idle', position: next.position, inSeam: next.inSeam }, pageOnScreen());
    this.onChange(next);
  }

  private heard = handoffWatcher(noteHandoffHeard);

  /** The facts with the level chosen here in place of the session's, until the session says it. */
  private shownFacts(): PlayerFacts {
    return this.chosen ? { ...this.facts, heldVolume: Math.round(this.chosen.level * 100) } : this.facts;
  }

  /** Tell the session the volume, once per drag: a slider moves many times, and every press but
   * the first would be based on a sequence the first had already moved on (refused as stale, with
   * the level jumping back). The last level is sent when the slider has been still for a moment. */
  private sendVolume(volume: number) {
    if (!this.actions.remoteControl) return;
    this.chosen = { level: volume, until: Date.now() + VOLUME_HOLD_MS };
    clearTimeout(this.volumeTimer);
    this.volumeTimer = setTimeout(() => {
      void this.actions.command('set_volume', { volume: Math.round(volume * 100) });
    }, VOLUME_SETTLE_MS);
  }

  /** Say a sentence about playback (a stop after playing offline) until the next press. */
  say(text: string): void {
    this.publish(text);
  }

  /** The bounded playback clock: re-reads the facts so played time moves at the tick rate. */
  tick(): void {
    this.publish();
  }

  private get speaking() { return this.facts.speaking; }

  /** ADR-0475: "Play here instead": the music moves here from wherever it is starting or playing. */
  /** Asked by another device to play: the next start happens only while no other device is
   * the speaker, so a "Play here instead" pressed there meanwhile is never overturned. */
  startFreeOnce = false;
  /** ADR-0475 I85: asked to take the music over ("Move and play"): the next start moves it here
   * from the device that is playing, as Play here instead does, from the asked position. */
  startMovingOnce = false;

  async playHereInstead(): Promise<void> {
    if (!this.facts.mix.length) return this.publish(NOTHING_TO_PLAY);
    this.publish(await this.actions.playHere(undefined, true));
  }

  async playFrom(position: number, offset = 0): Promise<void> {
    if (!this.facts.mix.length) return this.publish(NOTHING_TO_PLAY);
    if (this.facts.refusal) return this.publish('');
    if (!this.speaking) {
      // A new speaker starts where this press asked (the first play of a visit used to carry on
      // from wherever the last mix was left); its heartbeat then tells the session (ADR-0415).
      const free = this.startFreeOnce;
      const moving = this.startMovingOnce;
      this.startFreeOnce = false;
      this.startMovingOnce = false;
      const problem = await this.actions.playHere({ song_index: position, offset_ms: Math.max(0, Math.round(offset * 1000)) }, moving ? true : free ? 'free' : undefined);
      return this.publish(problem);
    }
    await this.seekTo(position, offset);
  }

  private async seekTo(position: number, seconds: number) {
    const offsetMs = Math.max(0, Math.round(seconds * 1000));
    if (this.actions.remoteControl) await this.actions.command('seek', { song_index: position, offset_ms: offsetMs });
    else if (this.speaking) await this.actions.speaker?.start(position, offsetMs, true);
    this.publish('');
  }

  async togglePause(): Promise<void> {
    if (!this.facts.mix.length) return this.publish(NOTHING_TO_PLAY);
    const playing = this.state.phase === 'playing';
    // a session left past the end of this mix (an older, longer mix) names no song: this mix
    // starts from its first song instead of stopping in silence
    const pastEnd = (this.facts.view?.session?.song_index ?? 0) >= this.facts.mix.length && !(this.speaking && this.facts.here);
    tabLog('togglePause', { speaking: this.speaking, speaker: this.facts.view?.speaker, mix: this.facts.mix.length });
    if (!this.speaking && this.facts.view?.speaker !== 'elsewhere') {
      const problem = await this.actions.playHere();
      if (!problem && pastEnd) return this.seekTo(0, 0);
      return this.publish(problem);
    }
    if (pastEnd && this.speaking) {
      // this device is the speaker: its engine starts the first song and its heartbeat tells the
      // session, rather than a seek and a play racing each other through the server
      await this.actions.speaker?.start(0, 0, true);
      return this.publish('');
    }
    if (this.actions.remoteControl) await this.actions.command(playing ? 'pause' : 'play');
    else if (this.speaking) {
      if (playing) this.actions.speaker?.pause();
      else this.actions.speaker?.resume();
    }
    this.publish('');
  }

  async next(): Promise<void> {
    if (this.state.position + 1 >= this.facts.mix.length) return;
    if (this.actions.remoteControl) await this.actions.command('skip');
    else if (this.speaking) await this.actions.speaker?.start(this.state.position + 1, 0, true);
    this.publish('');
  }

  async previous(): Promise<void> {
    // like the local player: early in a song, go back one; otherwise start this one again
    const target = this.state.songTime > 4 || this.state.position === 0 ? this.state.position : this.state.position - 1;
    await this.seekTo(target, 0);
  }

  /** Jump to the transition, as local mode's does: a few seconds before it. The browser plans a
   * seam only as its song nears the end, so a jump first moves to where planning starts, then
   * lands before the seam once it is scheduled. Elsewhere (no engine here) it goes to the next song. */
  async skip(): Promise<void> {
    if (!this.speaking || this.state.position + 1 >= this.facts.mix.length) return this.next();
    const seam = this.state.seamAt;
    if (seam !== null) {
      if (this.state.songTime < seam - JUMP_LEAD_SECONDS) return this.seekTo(this.state.position, seam - JUMP_LEAD_SECONDS);
      return this.next();
    }
    // the stored length, or the decoded one when the catalogue has none (nowStateFrom)
    const duration = this.state.duration;
    const planFrom = Math.max(0, duration - LOAD_NEXT_WITHIN + 1);
    this.jumping = this.state.position;
    if (this.state.songTime < planFrom) await this.seekTo(this.state.position, planFrom);
  }

  async seek(seconds: number): Promise<void> {
    await this.seekTo(this.state.position, seconds);
  }

  stop(): void {
    if (this.speaking) this.actions.speaker?.stop(0);
    this.publish('');
  }

  toggleMute(): void {
    if (this.sound.muted) {
      this.sound.muted = false;
      this.sound.volume = this.sound.lastAudibleVolume;
    } else {
      if (this.sound.volume > 0) this.sound.lastAudibleVolume = this.sound.volume;
      this.sound.muted = true;
      this.sound.volume = 0;
    }
    const volume = this.sound.volume;
    this.actions.speaker?.setVolume(volume);
    this.sendVolume(volume);
    this.publish('');
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.sound.volume = Math.max(0, Math.min(1, volume));
    this.sound.muted = this.sound.volume === 0;
    if (!this.sound.muted) this.sound.lastAudibleVolume = this.sound.volume;
    this.actions.speaker?.setVolume(this.sound.volume);
    this.sendVolume(this.sound.volume);
    this.publish('');
  }

  /** The engine's own analyser, read only (ADR-0477), and only while the music is made on this
   * device. Playing on another device there is nothing here to measure, so this stays null. */
  getSpectrum(): Uint8Array | null {
    return this.speaking ? this.actions.speaker?.spectrum() ?? null : null;
  }

  getVisualTaps(): { left: AnalyserNode; right: AnalyserNode } | null {
    return this.speaking ? this.actions.speaker?.spectrumTaps() ?? null : null;
  }
}

/** What the seam provider is told about the programme (BF-0459-04, BF-0465-03). */
export type SeamWiring = {
  /** The seam settings for the transition into the song at `toIndex` (mix[toIndex].seam). */
  settingsFor(toIndex: number): SeamSettingsLike | null | undefined;
  /** Which music path a resolved song came from. */
  sourceOf(index: number): MusicSource | null;
  onPlanned(record: SeamRecord): void;
  /** The moves this account has on (cloud/browserMoves.ts). */
  allowed?(): readonly string[] | undefined;
  /** Cached stems for stem moves (cloud.browser_stems); reads only, never splits on the seam path. */
  stems?: StemReading;
  /** Explicit, device-bound worker calibration; omission keeps Tier 2 on the fade fallback. */
  workerCalibration?: WorkerCalibration | null;
  /** Must be the same stable local identity used when the calibration was recorded. */
  deviceId?: string | null;
  /** The account's planner for each transition (accountSeams.ts); without it this device chooses. */
  planned?: (ask: AccountSeamAsk) => Promise<AccountSeamAnswer>;
};

/** Opens the engine from a press and makes this device's speaker. Injectable for tests. */
export type EngineStarter = (
  /** `level`: the gain a song must play at (cloud.studio_seams); measured when absent. */
  resolve: (index: number) => Promise<{ id: number | string; data: () => Promise<ArrayBuffer>; level?: number } | null>,
  queueLength?: () => number,
  seams?: SeamWiring,
  /** Told each time the engine has decoded a song to play (engine/speakerAdapter.ts decoded). */
  decoded?: (id: number | string, buffer: AudioBuffer) => void,
) => Promise<{ speaker: BrowserSpeaker; refusal: string | null } | { speaker: null; refusal: string }>;

/** The real starter: AudioContext from the press, the measured probe, worker calibration, the
 * capability roster, then the speaker with its worker-backed seam provider. */
export const startBrowserEngine: EngineStarter = async (resolve, queueLength, seams, decoded) => {
  const engine: Engine = createEngine();
  try {
    const opened = engine.openContext({ fromUserGesture: true });
    if ('state' in opened) {
      engine.dispose();
      return { speaker: null, refusal: opened.reason };
    }
    const probe = await engine.probe(opened.context);
    let budgetEvidence = seams?.workerCalibration && seams.deviceId
      ? { calibration: seams.workerCalibration, deviceId: seams.deviceId, atFloor: false, deadlineMisses: 0 }
      : null;
    const stretch = await engine.stretchEvidence();
    // the limiter that really went in, once the speaker has installed it: without it the roster
    // named the compressor fallback even when the worklet limiter was running
    let limiter: Awaited<ReturnType<BrowserSpeaker['limiter']>> | null = null;
    const rosterNow = () => engine.roster({ probe, limiter, workerBudget: budgetEvidence, stretch });
    let roster = rosterNow();
    const seam = seams ? provider.makeWorkerSeamProvider({
      ...seams,
      calibration: seams.workerCalibration,
      deviceId: seams.deviceId,
      patient: seamLeadOn,
      abilities: () => provider.abilitiesFrom((feature) => roster.get(feature)),
      sourceSafe: (source) => provider.abilityOf((feature) => roster.get(feature), `seam_source_${source}`),
      onBudgetState: (state) => {
        if (budgetEvidence) {
          budgetEvidence = {
            ...budgetEvidence,
            atFloor: !state.supported,
            deadlineMisses: state.deadlineMisses,
          };
          roster = rosterNow();
        }
      },
    }) : undefined;
    // queueLength lets an unavailable track skip with a notice instead of ending the set (ADR-0458)
    // cloud.seam_lead (ADR-0479 phase 1): plan each transition as its song starts, and play every
    // song at one level; both read the flag as they run, so a change needs no new speaker
    const speaker = engine.createSpeaker({
      audio: opened, probe, resolve, queueLength, seam, decoded,
      planAhead: seamLeadOn,
      level: (buffer) => (seamLeadOn() ? songLevels().of(buffer) : Promise.resolve(1)),
    });
    void speaker.limiter().then((installed) => { limiter = installed; roster = rosterNow(); }, () => undefined);
    return { speaker, refusal: probe.ok ? null : probe.reason };
  } catch (problem) {
    engine.dispose();
    return { speaker: null, refusal: `SelectaDJ could not prepare browser audio: ${(problem as Error)?.message || 'unknown reason'}.` };
  }
};

/** How many scheduled seams the hook remembers for surfaces and tests. */
export const SEAMS_KEPT = 128;
/** A jump to the transition lands this long before the seam starts. */
export const JUMP_LEAD_SECONDS = 4;

const offlinePlaybackOn = () => flagOn('cloud.offline_playback');
/** ADR-0479 phase 1: early seam planning, song levels and patient analysis. */
export const SEAM_LEAD_FLAG = 'cloud.seam_lead';
const seamLeadOn = () => flagOn(SEAM_LEAD_FLAG);
// one measuring worker for the page, made the first time a song needs its level
let levels: Levels | null = null;
const songLevels = (): Levels => (levels ??= createLevels());

/** The hook the local-first shell uses: one stable LocalFirstPlayer over the device session. */
/** Worker calibration is device evidence (ADR-0457): measured on this device, at most 30 days
 * old. It is remembered per device identity, re-measured in the background when missing or
 * stale, and a press that arrives mid-measurement waits for it rather than silently playing a
 * whole visit of style-less fades. A device that cannot be measured keeps the labelled fade. */
const CALIBRATION_KEY = (deviceId: string) => `selecta.dsp.calibration.${deviceId}`;

export function recallCalibration(deviceId: string): WorkerCalibration | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY(deviceId));
    if (!raw) return null;
    const kept = JSON.parse(raw) as WorkerCalibration;
    return workerCalibrationState(kept, deviceId).supported ? kept : null;
  } catch {
    return null;
  }
}

export function rememberCalibration(made: WorkerCalibration): void {
  try {
    localStorage.setItem(CALIBRATION_KEY(made.deviceId), JSON.stringify(made));
  } catch {
    // nothing: an unwritable store only means measuring again next visit
  }
}

export function useLocalFirstPlayer({ api, workspaceId, mix, remoteControl, resolver, starter = startBrowserEngine, request, decoded: whenDecoded }: {
  api: Api;
  workspaceId: string;
  mix: readonly (Pick<MixItem, 'duration' | 'song_id'> & { seam?: Pick<NonNullable<MixItem['seam']>, 'settings'> | null })[];
  remoteControl: boolean;
  /** The media agent's resolver (media/makeResolver), opened lazily; null before it exists. */
  resolver: () => Promise<MediaResolver | null>;
  starter?: EngineStarter;
  /** The catalogue's request, to save a length decoded here for a song that has none (songLength.ts);
   * with `cloudOwnCopies`, the songs with their own cloud copy (cloud.studio_seams). */
  request?: (<T>(path: string, init?: RequestInit) => Promise<T>) & { cloudOwnCopies?: (songIds: readonly number[]) => Promise<ReadonlySet<number>> };
  /** Told, by song, each time the engine has decoded one to play (Listen's waveforms read it). */
  decoded?: (songId: number, audio: AudioBuffer) => void;
}) {
  // read when a song decodes, so the speaker made from an earlier press reaches the latest one
  const onDecoded = useRef(whenDecoded);
  onDecoded.current = whenDecoded;
  const [speaker, setSpeaker] = useState<BrowserSpeaker | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [, tick] = useState(0);
  const pb = usePlaybackDevice({ api, workspaceId, speaker, remoteControl });
  const songs = useRef(mix);
  songs.current = mix;
  const owner = useRef<string | null | undefined>(undefined);
  // the person chose this device over whichever plays (Play here instead)
  const insisting = useRef(false);
  // State, not a ref: the speaker usually lands (and this effect runs) before the session refresh
  // decides the lease is wanted, so the decision itself must re-run the effect.
  const [wantHere, setWantHere] = useState(false);
  /** where the next new speaker begins, kept across the render that opens it */
  const startAt = useRef<StartAt | undefined>(undefined);
  const [seams, setSeams] = useState<PlayedRecord[]>([]);
  const calibration = useRef<{ deviceId: string; record: WorkerCalibration | null; measuring: Promise<WorkerCalibration | null> | null } | null>(null);
  useEffect(() => {
    let gone = false;
    const deviceId = mediaDeviceId(workspaceId);
    const kept = recallCalibration(deviceId);
    const mine = { deviceId, record: kept, measuring: null as Promise<WorkerCalibration | null> | null };
    calibration.current = mine;
    if (!kept && typeof Worker !== 'undefined') {
      mine.measuring = provider.calibrateAnalysisInWorker({ deviceId }).then((made) => {
        if (made) {
          rememberCalibration(made);
          if (!gone) mine.record = made;
        }
        mine.measuring = null;
        return made;
      }).catch(() => (mine.measuring = null));
    }
    return () => { gone = true; };
  }, [workspaceId]);
  const sources = useRef(new Map<number, MusicSource>());
  // the file on this device each position plays from, for planning from the account
  const held = useRef(new Map<number, { songId: number; sha: string }>());
  const speakerNow = useRef<BrowserSpeaker | null>(null);
  speakerNow.current = speaker;
  const apiNow = useRef(api);
  apiNow.current = api;
  // cloud.device_render: transitions rendered ahead in play order, from the speaker's own decodes
  const studio = useMemo(() => makeDeviceStudio({
    request: (path, init) => apiNow.current(path, init, workspaceId),
    workspaceId,
    decodedAt: async (index) => (await speakerNow.current?.decodedAt(index)) ?? null,
    level: (buffer) => (seamLeadOn() ? songLevels().of(buffer) : Promise.resolve(1)),
    // a request's song, not in the mix yet: only this device's own file (T-20261126-a246)
    songHere: async (songId) => {
      const found = await (await resolver())?.(songId);
      if (!found?.held || (found.source ?? 'device') !== 'device') return null;
      return { song: found.held, data: found.data, decoded: async () => (await speakerNow.current?.decodedSource({ id: found.id, data: found.data })) ?? null };
    },
  }), [workspaceId, resolver]);
  useEffect(() => () => studio.dispose(), [studio]);
  // cloud.studio_seams: transitions between cloud library songs made in the cloud, two ahead
  const cloud = useMemo(() => new CloudSeams({
    request: (path, init) => apiNow.current(path, init, workspaceId),
    // decoded by the playing context, at its rate, as the songs are
    decode: async (bytes) => (await speakerNow.current?.decodedSource({ id: 'cloud-clip', data: async () => bytes })) ?? null,
    heard: () => {
      const at = speakerNow.current?.position();
      return at ? { index: at.song_index, seconds: at.offset_ms / 1000 } : null;
    },
    on: () => cloudSeamsOn() && seamLeadOn(),
  }), [workspaceId]);
  useEffect(() => () => cloud.dispose(), [cloud]);
  // the song each lossless file plays, for Listen's waveforms
  const cloudFiles = useRef(new Map<string, number>());
  // The stem prefetcher (cloud.browser_stems): splits the windows the next transitions need while
  // this song plays. Only with the flag on, the stem model's licence cleared and a model published.
  const prefetcher = useMemo(() => {
    const artefact = STEM_MODEL_ARTEFACT;
    if (!stemsFlagOn(flagOn) || stemsLicenceHold() || !artefact) return null;
    return new StemPrefetcher({
      separate: workerSeparator(spawnStemsWorker(), { sha256: artefact.sha256 }),
      getAudio: async (songId) => {
        const track = await (await resolver())?.(songId);
        if (!track || typeof OfflineAudioContext === 'undefined') return null;
        return new OfflineAudioContext(2, 1, 44100).decodeAudioData(await track.data());
      },
      scope: () => ({ workspaceId, shared: flagOn('cloud.content_cache') }),
      guard: { arm: () => armCrashGuard(), disarm: () => disarmCrashGuard() },
    });
  }, [workspaceId, resolver]);
  useEffect(() => () => prefetcher?.dispose(), [prefetcher]);
  const prefetchRef = useRef(prefetcher);
  prefetchRef.current = prefetcher;
  const seamsRef = useRef<PlayedRecord[]>([]);
  const stemReading = useMemo<StemReading>(() => ({
    read: async (songId, part) => {
      const song = songs.current.find((item) => item.song_id === songId);
      const window = song ? stemWindow(song.duration, part) : null;
      return prefetchRef.current && window ? prefetchRef.current.readStems(songId, window) : null;
    },
    songId: (index) => songs.current[index]?.song_id ?? null,
    allowed: () => browserStemMovesAllowed(flagOn),
    preference: () => 'sometimes',
    history: () => seamsRef.current.map((record) => record.schedule.style ?? 'blend'),
    totalSeams: () => Math.max(1, songs.current.length - 1),
  }), []);
  const wiring = useMemo<SeamWiring>(() => ({
    settingsFor: (toIndex) => songs.current[toIndex]?.seam?.settings ?? null,
    sourceOf: (index) => sources.current.get(index) ?? null,
    // each record names its two songs, so a later edit of the mix can't pin it on the wrong seam
    onPlanned: (record) => setSeams((kept) => [...kept, { ...record, pair: [songs.current[record.fromIndex]?.song_id ?? null, songs.current[record.toIndex]?.song_id ?? null] as const }].slice(-SEAMS_KEPT)),
    allowed: () => (browserMovesOn() ? browserMovesAllowed() : undefined),
    stems: stemReading,
    // the cloud studio first for its own seams, then the account's planner (cloudSeams.ts)
    planned: withCloudSeams(cloud, accountSeamPlanner({
      request: (path, init) => apiNow.current(path, init, workspaceId),
      workspaceId,
      fileOf: (index) => held.current.get(index)?.songId ?? null,
      shaOf: async (songId) => [...held.current.values()].find((one) => one.songId === songId)?.sha ?? null,
      heard: () => {
        const at = speakerNow.current?.position();
        return at ? { index: at.song_index, seconds: at.offset_ms / 1000 } : null;
      },
      studio,
    })),
  }), [stemReading, workspaceId, studio, cloud]);

  useEffect(() => speaker?.onState(setEngine), [speaker]);
  // the clock moves while playing: redraw the position twice a second, never faster
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 500);
    return () => window.clearInterval(timer);
  }, []);

  const resolve = useCallback(async (index: number) => {
    const songId = songs.current[index]?.song_id;
    const usual = async () => (songId === undefined ? null : (await (await resolver())?.(songId)) ?? null);
    // cloud.studio_seams: a song next to a cloud seam plays its lossless file at its clip's level
    const lossless = songId === undefined ? null : await cloud.songAt(index, songId, usual).catch(() => null);
    if (lossless && songId !== undefined) cloudFiles.current.set(lossless.id, songId);
    const found = lossless ?? await usual();
    if (found) sources.current.set(index, found.source ?? 'device');
    else sources.current.delete(index);
    if (found && 'held' in found && found.held && (found.source ?? 'device') === 'device') held.current.set(index, found.held);
    else held.current.delete(index);
    return found ? { id: found.id, data: found.data, ...(found.level !== undefined ? { level: found.level } : {}) } : null;
  }, [resolver, cloud]);

  // A speaker made from a press asks for the lease once it exists.
  useEffect(() => {
    if (!speaker || !wantHere || !pb.device) return;
    setWantHere(false);
    const at = startAt.current;
    startAt.current = undefined;
    // 'Play here instead': take over from whoever plays by then, with no condition on who that is
    void pb.playHere(insisting.current ? undefined : owner.current, at);
    insisting.current = false;
  }, [speaker, wantHere, pb.device, pb.playHere]);

  const playHere = useCallback(async (at?: StartAt, insist: boolean | 'free' = false): Promise<string> => {
    tabLog('player playHere', { refusal: !!refusal, speaker: !!speaker });
    if (refusal) return '';
    startAt.current = at;
    // Open the AudioContext synchronously from the player's press, before the session fetch.
    // iOS Safari and autoplay policies may reject play() if setup waits on network first.
    const needsSpeaker = !speaker;
    let madeSpeaker: BrowserSpeaker | null = null;
    if (needsSpeaker) {
      const measured = calibration.current;
      if (measured && !measured.record && measured.measuring) await measured.measuring;
      const made = await starter(resolve, () => songs.current.length, {
        ...wiring,
        workerCalibration: measured?.record ?? null,
        deviceId: measured?.deviceId ?? null,
      }, (id, buffer) => {
        cloud.noteDecoded(id, buffer);
        const songId = typeof id === 'number' ? id : cloudFiles.current.get(id);
        if (songId !== undefined) onDecoded.current?.(songId, buffer);
      });
      if (made.refusal) {
        made.speaker?.dispose();
        setRefusal(made.refusal);
        return made.refusal;
      }
      if (!made.speaker) return 'SelectaDJ could not open audio in this browser. Try again.';
      setSpeaker(made.speaker);
      madeSpeaker = made.speaker;
    }
    const latest = await pb.refreshSession();
    if (!latest && offlinePlaybackOn() && !isOnline()) {
      // cloud.offline_playback: no connection, so this device plays its own files and settles
      // with the server when it is back (usePlaybackDevice.playOffline)
      const made = needsSpeaker ? madeSpeaker : speaker;
      const session = pb.view?.session ?? null;
      const carried = session && session.state !== 'stopped' && session.song_index < songs.current.length ? session.song_index : 0;
      const index = at ? at.song_index : carried;
      const offset = at ? at.offset_ms : session && index === session.song_index ? extrapolate(session, pb.serverNow()) : 0;
      if (await pb.playOffline(index, offset, made)) return '';
    }
    if (!latest) {
      // A failed account refresh does not leave a newly opened AudioContext around. The member
      // can retry from a fresh press, which also renews the browser's gesture authorization.
      if (needsSpeaker) {
        setSpeaker((made) => {
          made?.dispose();
          return null;
        });
      }
      return pb.error || 'SelectaDJ could not reach your account just now. Try again.';
    }
    // another tab of this same browser is the speaker: the press here is the answer (ADR-0475 F)
    const sameDevice = !!latest.speaker_device_id && latest.speaker_device_id === pb.device?.id;
    // the person chose here over the device that is starting or playing: take over from it
    insisting.current = insist === true;
    // asked from elsewhere: only while nobody plays; the take-over then requires that still
    if (insist === 'free') {
      if (latest.speaker === 'elsewhere') return '';
      owner.current = null;
    }
    if (!insist && latest.ask_before_playing_here && !sameDevice && owner.current !== latest.speaker_device_id) {
      // the same confirmation the playing bar asks for, as a second press
      owner.current = latest.speaker_device_id;
      return `Playing on ${latest.speaker_name ?? 'another device'}. Press play again to move it here.`;
    }
    if (owner.current === undefined) owner.current = null;
    if (needsSpeaker) {
      setWantHere(true);
      return '';
    }
    startAt.current = undefined;
    await pb.playHere(insist === true ? undefined : owner.current, at);
    return '';
  }, [pb, refusal, resolve, speaker, starter, wiring]);

  const actions: PlayerActions = { playHere, command: pb.command, remoteControl, speaker };
  const here = speaker?.position() ?? null;
  const clock = speaker?.clock?.() ?? null;
  const facts: PlayerFacts = {
    mix, view: pb.view, speaking: pb.isSpeaker(), here, engine, refusal,
    serverNow: pb.serverNow(), said: '', seam: seams[seams.length - 1] ?? null, seams, clock,
    heldVolume: offlinePlaybackOn() ? pb.heldVolume() : null,
  };
  const player = useMemo(() => new LocalFirstPlayer(facts, actions), []);
  // facts change every render; the player tells its listener only when the state moved
  useEffect(() => { player.update(facts, actions); });
  // playing offline ended because another device took over (or the sign-in ended): say so
  useEffect(() => { if (pb.offlineNotice) player.say(pb.offlineNotice); }, [player, pb.offlineNotice]);
  // While this device speaks, a real clock moves the played time forward; render-driven
  // updates alone would either freeze the strip or loop (see publish).
  const speaking = pb.isSpeaker();
  useEffect(() => {
    if (!speaking) return;
    const clock = window.setInterval(() => player.tick(), 250);
    return () => window.clearInterval(clock);
  }, [speaking, player]);
  seamsRef.current = seams;
  // each time a new song starts here, prepare the stems the next transitions will need
  const position = player.state.position;
  useEffect(() => {
    prefetcher?.plan(mix.map((item) => ({ songId: item.song_id, durationS: item.duration })), position);
  }, [prefetcher, position, mix]);
  // the next two transitions rendered ahead, from the songs this device holds (deviceStudio.ts)
  useEffect(() => {
    if (!speaker || !deviceRenderOn()) return studio.follow([], position);
    let live = true;
    const ahead = [position, position + 1, position + 2].filter((index) => index < mix.length);
    void Promise.all(ahead.map((index) => resolve(index).then(() => held.current.get(index) ?? null, () => null))).then((songs) => {
      const order: (StudioSong | null)[] = [];
      ahead.forEach((index, at) => { order[index] = songs[at]; });
      if (live) studio.follow(order, position);
    });
    return () => { live = false; };
  }, [studio, speaker, position, mix, resolve]);
  // cloud.studio_seams: which seams the cloud studio makes (studioPlan.ts), worked out per mix
  // null until worked out, so a song starting meanwhile waits a moment for it (cloudSeams.ts songAt)
  const [cloudPairs, setCloudPairs] = useState<readonly (CloudPair | null)[] | null>(null);
  const ownCopies = request?.cloudOwnCopies;
  useEffect(() => {
    if (!ownCopies || !cloudSeamsOn() || !seamLeadOn()) { setCloudPairs([]); return undefined; }
    let live = true;
    void cloudPairsOf(mix, ownCopies, { device: deviceRenderOn(), here: (index) => held.current.has(index), connection: browserConnection() })
      .then((pairs) => { if (live) setCloudPairs(pairs); }, () => undefined);
    return () => { live = false; };
  }, [mix, ownCopies]);
  // ...and the next two of them asked for, from the playing song
  useEffect(() => { if (speaker && cloudPairs) cloud.follow(cloudPairs, position); }, [cloud, speaker, cloudPairs, position]);
  const prefetch: Observable<PrefetchState> | null = prefetcher?.state ?? null;
  // T-20261125-8ab8: the song the engine decoded has a length the catalogue lacks; keep it there
  const playingSong = here ? mix[here.song_index] : undefined;
  const decoded = clock?.length ?? 0;
  useEffect(() => {
    if (!request || !playingSong || playingSong.duration > 0 || !(decoded > 0)) return;
    void saveSongLength(request, playingSong.song_id, decoded, workspaceId);
  }, [request, playingSong?.song_id, playingSong?.duration, decoded > 0, workspaceId]);
  // what this device's sound output can truthfully be called now, for the sound check on Listen
  return { player, device: pb, refusal, seams, prefetch, output: statusOf(facts) };
}

