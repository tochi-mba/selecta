import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixItem } from '../api';
import * as provider from '../dsp/seamProvider';
import type { MusicSource, SeamRecord, SeamSettingsLike } from '../dsp/seamProvider';
import { playbackStatusText, type PlaybackStatus } from '../copy';
import { Api, extrapolate, Position, SessionView, usePlaybackDevice } from '../devices/usePlaybackDevice';
import { createEngine, type BrowserSpeaker, type Engine, type EngineState } from '../engine';
import type { WorkerCalibration } from '../dsp/budget';
import type { MediaResolver } from '../media';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';

/** The shell player for local-first Cloud (ADR-0462 BF-0462-06): the browser engine's speaker
 * (ADR-0457 BrowserSpeaker) driven through the ADR-0415 playback session (usePlaybackDevice),
 * presented as the same PlayerLike the local shell and views already use.
 *
 * Truth rules, all from ADR-0457/0460/0461:
 * - `phase` 'playing' only when this device's engine is playing, or the server says another device
 *   is and its lease is fresh. A lapsed lease (`state_confidence` uncertain) is never 'playing'.
 * - `notice` carries the one status vocabulary (copy.ts); a passing probe or a running graph never
 *   claims audible sound, only a person's sound-check confirmation does.
 * - What the engine cannot do yet is an honest no-op with a reason, never a silent success:
 *   the spectrum (no analyser is exposed).
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
  const position = facts.speaking && facts.here ? facts.here.song_index : session?.song_index ?? 0;
  const offsetMs = facts.speaking && facts.here
    ? facts.here.offset_ms
    : session && phase !== 'idle' ? extrapolate(session, facts.serverNow) : 0;
  const status = statusOf(facts);
  const words = status ? playbackStatusText(status) : '';
  // only a schedule this device's engine was handed, out of the song playing here, counts
  const seam = facts.speaking && facts.seam && facts.seam.fromIndex === position ? facts.seam.schedule : null;
  const songTime = offsetMs / 1000;
  return {
    phase,
    position,
    songTime,
    duration: facts.mix[position]?.duration ?? 0,
    inSeam: !!seam && songTime >= seam.startSeconds && songTime < seam.startSeconds + seam.windowSeconds,
    seamAt: seam ? seam.startSeconds : null,
    notice: facts.said || facts.engine?.notice || words,
    nextReady: !!seam,
    lastSeamKey: null,
    volume: facts.view?.session?.volume == null
      ? sound.volume
      : Math.max(0, Math.min(1, facts.view.session.volume / 100)),
    muted: facts.view?.session?.volume === 0 || sound.muted,
  };
}

/** What the player can ask of the device session and the engine. */
export type PlayerActions = {
  /** Make this device the speaker (from a press); resolves with a sentence when it could not. */
  playHere(): Promise<string>;
  command(name: 'play' | 'pause' | 'skip' | 'seek' | 'set_volume', args?: Record<string, unknown>): Promise<void>;
  /** Whether remote commands work; when off, this device steers its own speaker directly. */
  remoteControl: boolean;
  speaker: BrowserSpeaker | null;
};

export class LocalFirstPlayer implements PlayerLike {
  state: NowState;
  onChange: (state: NowState) => void = () => {};
  private facts: PlayerFacts;
  private actions: PlayerActions;
  private sound = { volume: 1, muted: false, lastAudibleVolume: 1 };

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
    const sessionVolume = facts.view?.session?.volume;
    if (typeof sessionVolume === 'number' && Number.isFinite(sessionVolume)) {
      this.sound.volume = Math.max(0, Math.min(1, sessionVolume / 100));
      this.sound.muted = this.sound.volume === 0;
      if (!this.sound.muted) this.sound.lastAudibleVolume = this.sound.volume;
    }
    if (actions.speaker) actions.speaker.setVolume(this.sound.muted ? 0 : this.sound.volume);
    this.publish();
  }

  private publish(said?: string) {
    if (said !== undefined) this.facts = { ...this.facts, said };
    const next = nowStateFrom(this.facts, this.sound);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange(next);
  }

  private get speaking() { return this.facts.speaking; }

  async playFrom(position: number, offset = 0): Promise<void> {
    if (!this.facts.mix.length) return this.publish(NOTHING_TO_PLAY);
    if (this.facts.refusal) return this.publish('');
    if (!this.speaking) {
      // The session decides where a new speaker starts (ADR-0415); taking over first, then
      // moving, never claims a position the server has not agreed.
      const problem = await this.actions.playHere();
      if (problem) return this.publish(problem);
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
    if (!this.speaking && this.facts.view?.speaker !== 'elsewhere') {
      const problem = await this.actions.playHere();
      return this.publish(problem);
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

  /** The browser engine plans no transitions yet, so the jump goes to the next song's start. */
  async skip(): Promise<void> {
    await this.next();
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
    if (this.actions.remoteControl) {
      void this.actions.command('set_volume', { volume: Math.round(volume * 100) });
    }
    this.publish('');
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.sound.volume = Math.max(0, Math.min(1, volume));
    this.sound.muted = this.sound.volume === 0;
    if (!this.sound.muted) this.sound.lastAudibleVolume = this.sound.volume;
    this.actions.speaker?.setVolume(this.sound.volume);
    if (this.actions.remoteControl) {
      void this.actions.command('set_volume', { volume: Math.round(this.sound.volume * 100) });
    }
    this.publish('');
  }

  getSpectrum(): Uint8Array | null {
    return null;
  }

  getVisualTaps(): { left: AnalyserNode; right: AnalyserNode } | null {
    return null;
  }
}

/** What the seam provider is told about the programme (BF-0459-04, BF-0465-03). */
export type SeamWiring = {
  /** The seam settings for the transition into the song at `toIndex` (mix[toIndex].seam). */
  settingsFor(toIndex: number): SeamSettingsLike | null | undefined;
  /** Which music path a resolved song came from. */
  sourceOf(index: number): MusicSource | null;
  onPlanned(record: SeamRecord): void;
  /** Explicit, device-bound worker calibration; omission keeps Tier 2 on the fade fallback. */
  workerCalibration?: WorkerCalibration | null;
  /** Must be the same stable local identity used when the calibration was recorded. */
  deviceId?: string | null;
};

/** Opens the engine from a press and makes this device's speaker. Injectable for tests. */
export type EngineStarter = (
  resolve: (index: number) => Promise<{ id: number; data: () => Promise<ArrayBuffer> } | null>,
  queueLength?: () => number,
  seams?: SeamWiring,
) => Promise<{ speaker: BrowserSpeaker; refusal: string | null } | { speaker: null; refusal: string }>;

/** The real starter: AudioContext from the press, the measured probe, worker calibration, the
 * capability roster, then the speaker with its worker-backed seam provider. */
export const startBrowserEngine: EngineStarter = async (resolve, queueLength, seams) => {
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
    let roster = engine.roster({ probe, workerBudget: budgetEvidence });
    const seam = seams ? provider.makeWorkerSeamProvider({
      ...seams,
      calibration: seams.workerCalibration,
      deviceId: seams.deviceId,
      abilities: () => provider.abilitiesFrom((feature) => roster.get(feature)),
      sourceSafe: (source) => provider.abilityOf((feature) => roster.get(feature), `seam_source_${source}`),
      onBudgetState: (state) => {
        if (budgetEvidence) {
          budgetEvidence = {
            ...budgetEvidence,
            atFloor: !state.supported,
            deadlineMisses: state.deadlineMisses,
          };
          roster = engine.roster({ probe, workerBudget: budgetEvidence });
        }
      },
    }) : undefined;
    // queueLength lets an unavailable track skip with a notice instead of ending the set (ADR-0458)
    const speaker = engine.createSpeaker({ audio: opened, probe, resolve, queueLength, seam });
    return { speaker, refusal: probe.ok ? null : probe.reason };
  } catch (problem) {
    engine.dispose();
    return { speaker: null, refusal: `SelectaDJ could not prepare browser audio: ${(problem as Error)?.message || 'unknown reason'}.` };
  }
};

/** How many scheduled seams the hook remembers for surfaces and tests. */
export const SEAMS_KEPT = 8;

/** The hook the local-first shell uses: one stable LocalFirstPlayer over the device session. */
export function useLocalFirstPlayer({ api, workspaceId, mix, remoteControl, resolver, starter = startBrowserEngine }: {
  api: Api;
  workspaceId: string;
  mix: readonly (Pick<MixItem, 'duration' | 'song_id'> & { seam?: Pick<NonNullable<MixItem['seam']>, 'settings'> | null })[];
  remoteControl: boolean;
  /** The media agent's resolver (media/makeResolver), opened lazily; null before it exists. */
  resolver: () => Promise<MediaResolver | null>;
  starter?: EngineStarter;
}) {
  const [speaker, setSpeaker] = useState<BrowserSpeaker | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [, tick] = useState(0);
  const pb = usePlaybackDevice({ api, workspaceId, speaker, remoteControl });
  const songs = useRef(mix);
  songs.current = mix;
  const owner = useRef<string | null | undefined>(undefined);
  // State, not a ref: the speaker usually lands (and this effect runs) before the session refresh
  // decides the lease is wanted, so the decision itself must re-run the effect.
  const [wantHere, setWantHere] = useState(false);
  const [seams, setSeams] = useState<SeamRecord[]>([]);
  const sources = useRef(new Map<number, MusicSource>());
  const wiring = useMemo<SeamWiring>(() => ({
    settingsFor: (toIndex) => songs.current[toIndex]?.seam?.settings ?? null,
    sourceOf: (index) => sources.current.get(index) ?? null,
    onPlanned: (record) => setSeams((kept) => [...kept, record].slice(-SEAMS_KEPT)),
  }), []);

  useEffect(() => speaker?.onState(setEngine), [speaker]);
  // the clock moves while playing: redraw the position twice a second, never faster
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 500);
    return () => window.clearInterval(timer);
  }, []);

  const resolve = useCallback(async (index: number) => {
    const songId = songs.current[index]?.song_id;
    const found = songId === undefined ? null : await (await resolver())?.(songId);
    if (found) sources.current.set(index, found.source ?? 'device');
    else sources.current.delete(index);
    return found ? { id: found.id, data: found.data } : null;
  }, [resolver]);

  // A speaker made from a press asks for the lease once it exists.
  useEffect(() => {
    if (!speaker || !wantHere || !pb.device) return;
    setWantHere(false);
    void pb.playHere(owner.current);
  }, [speaker, wantHere, pb.device, pb.playHere]);

  const playHere = useCallback(async (): Promise<string> => {
    if (refusal) return '';
    // Open the AudioContext synchronously from the player's press, before the session fetch.
    // iOS Safari and autoplay policies may reject play() if setup waits on network first.
    const needsSpeaker = !speaker;
    if (needsSpeaker) {
      const made = await starter(resolve, () => songs.current.length, wiring);
      if (made.refusal) {
        made.speaker?.dispose();
        setRefusal(made.refusal);
        return made.refusal;
      }
      if (!made.speaker) return 'SelectaDJ could not open audio in this browser. Try again.';
      setSpeaker(made.speaker);
    }
    const latest = await pb.refreshSession();
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
    if (latest.ask_before_playing_here && owner.current !== latest.speaker_device_id) {
      // the same confirmation the playing bar asks for, as a second press
      owner.current = latest.speaker_device_id;
      return `Playing on ${latest.speaker_name ?? 'another device'}. Press play again to move it here.`;
    }
    if (owner.current === undefined) owner.current = null;
    if (needsSpeaker) {
      setWantHere(true);
      return '';
    }
    await pb.playHere(owner.current);
    return '';
  }, [pb, refusal, resolve, speaker, starter, wiring]);

  const actions: PlayerActions = { playHere, command: pb.command, remoteControl, speaker };
  const facts: PlayerFacts = {
    mix, view: pb.view, speaking: pb.isSpeaker(), here: speaker?.position() ?? null, engine, refusal,
    serverNow: pb.serverNow(), said: '', seam: seams[seams.length - 1] ?? null,
  };
  const player = useMemo(() => new LocalFirstPlayer(facts, actions), []);
  // facts change every render; the player tells its listener only when the state moved
  useEffect(() => { player.update(facts, actions); });
  return { player, device: pb, refusal, seams };
}

