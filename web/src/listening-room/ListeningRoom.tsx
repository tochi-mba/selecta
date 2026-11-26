import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { holdNeutral } from '../feel/root';
import { flagOn } from '../flags';
import type { MediaResolver } from '../media';
import { navigate } from '../router';
import { announce } from '../ui/controls';
import { Skeleton } from '../ui/Skeleton';
import { deviceRenderOn } from '../cloud/deviceStudio';
import { createAuditionRoom, type AuditionEnd, type Pair, type Progress } from './audition';
import { RevealScreen } from './RevealScreen';
import {
  answerOf, chooseVerdict, countReplay, createSession, MADE_AHEAD_PAIRS, goTo, leaveSession, loadSession, nextOpen, recordFailure, recordPlayed,
  recordPrepared, saveSession, setNote, toggleReason, variantOf, type Label, type MixSong, type Session, type StorageLike, type Trial,
} from './session';
import { StartScreen } from './StartScreen';
import { TrialScreen, type Listening } from './TrialScreen';
import './listeningRoom.css';

/** The Listening Room (tools.listening_room): judging transitions by ear, blind, on this device.
 *
 * The session is built from the account's current mix and kept in this browser (session.ts); the
 * sound is the room's own engine (audition.ts), which never takes the device lease or tells the
 * server anything. The shell's player keeps the sound while it plays: the room asks for it to be
 * paused first, and stops its own audition if the mix starts again. */

export type ListeningRoomProps = {
  workspaceId: string;
  mix: readonly (MixSong & { seam?: { settings: Pair['settings'] } | null })[];
  mixName: string;
  mixId: string | null;
  /** The current mix has not been read yet. */
  loading: boolean;
  /** This device's own files (media/makeResolver), never a hosted copy. */
  resolve: MediaResolver;
  /** The shell's mix is playing on this device. */
  shellPlaying: boolean;
  pauseShell(): Promise<void> | void;
};

/** The flags the session is about, kept with it for the export. */
const FLAGS = ['tools.listening_room', 'cloud.seam_lead', 'cloud.browser_dsp', 'cloud.browser_moves', 'cloud.brain', 'cloud.device_render'] as const;
const VOLUME_KEY = 'selecta.listeningRoom.volume';
const storage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const savedVolume = () => {
  const kept = Number(storage()?.getItem(VOLUME_KEY) ?? NaN);
  return Number.isFinite(kept) ? Math.max(0, Math.min(1, kept)) : 0.8;
};
const soundHere = () => typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || 'webkitAudioContext' in window) && typeof Worker !== 'undefined';
const pairOf = (trial: Trial, mix: ListeningRoomProps['mix']): Pair => ({
  from: { songId: trial.from.songId, title: trial.from.title },
  to: { songId: trial.to.songId, title: trial.to.title },
  settings: mix.find((item, index) => item.song_id === trial.to.songId && mix[index - 1]?.song_id === trial.from.songId)?.seam?.settings ?? null,
});

function Go({ to, children, primary }: { to: string; children: ReactNode; primary?: boolean }) {
  return <a className={primary ? 'button primary' : 'button'} href={to} onClick={(event: MouseEvent) => { event.preventDefault(); navigate(to); }}>{children}</a>;
}

function Note({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="lr-note-card" aria-labelledby="lr-note-title">
      <h2 id="lr-note-title" className="lr-small-title">{title}</h2>
      <p className="lr-lead">{children}</p>
      {actions && <div className="lr-start-actions">{actions}</div>}
    </section>
  );
}

export default function ListeningRoom(props: ListeningRoomProps) {
  const { workspaceId, mix, mixName, mixId, loading, resolve, shellPlaying, pauseShell } = props;
  const room = useMemo(() => createAuditionRoom({ workspaceId, resolve }), [workspaceId, resolve]);
  useEffect(() => () => room.dispose(), [room]);
  // judging by ear, blind, is neutral too (ADR-0477 rule 11): no mix tint, beat chrome or offers
  useLayoutEffect(() => holdNeutral(), []);
  const [session, setSession] = useState<Session | null>(() => loadSession(storage(), workspaceId));
  const [resumed, setResumed] = useState(() => !!session);
  const [screen, setScreen] = useState<'start' | 'trial' | 'reveal'>('start');
  const [playable, setPlayable] = useState<Set<number> | null>(null);
  const [listening, setListening] = useState<Listening>({ label: null, progress: null, preparing: false, last: null });
  const [check, setCheck] = useState<Progress | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState('');
  const latest = useRef(session);
  latest.current = session;
  const signature = mix.map((item) => item.song_id).join(',');

  /** Change the session and keep it in this browser at once. */
  const update = useCallback((change: (kept: Session) => Session) => {
    const kept = latest.current;
    if (!kept) return;
    const next = change(kept);
    if (next === kept) return;
    latest.current = next;
    setSession(next);
    saveSession(storage(), next);
  }, []);

  useEffect(() => { room.setVolume(volume); }, [room, volume]);
  // which of the mix's songs this device holds; resolving reads no bytes
  useEffect(() => {
    if (loading) return undefined;
    let live = true;
    setPlayable(null);
    const ids = [...new Set(mix.map((item) => item.song_id))];
    void Promise.all(ids.map(async (id) => ((await resolve(id).catch(() => null)) ? id : null)))
      .then((found) => { if (live) setPlayable(new Set(found.filter((id): id is number => id !== null))); });
    return () => { live = false; };
  }, [signature, loading, resolve]);
  // a new session over the current mix when none was saved here
  useEffect(() => {
    if (session || !playable) return;
    // with transitions made ahead on, the planner made ahead is heard against the other two ways
    const made = createSession({ workspaceId, mixId, mixName, mix, playable: (id) => playable.has(id), flags: Object.fromEntries(FLAGS.map((id) => [id, flagOn(id)])), pairs: deviceRenderOn() ? MADE_AHEAD_PAIRS : undefined });
    if (made) {
      latest.current = made;
      setSession(made);
    }
  }, [session, playable]);
  // the mix started playing here again: it has the sound, so the audition stops
  useEffect(() => { if (shellPlaying) room.stop(); }, [shellPlaying, room]);

  const trial = session && screen === 'trial' ? session.trials[session.position] ?? null : null;
  // prepare the transition on screen once, then the next one in the background
  useEffect(() => {
    if (!trial || !opened || !session) return undefined;
    let live = true;
    const pair = pairOf(trial, mix);
    const known = answerOf(session, trial.id);
    setListening((now) => ({ ...now, preparing: known.startSeconds === null && !known.failed }));
    room.prepare(pair, trial.variants).then(({ startSeconds }) => {
      if (!live) return;
      setListening((now) => ({ ...now, preparing: false }));
      update((kept) => recordPrepared(kept, trial.id, startSeconds));
      const after = latest.current?.trials[latest.current.position + 1];
      if (after) void room.prepare(pairOf(after, mix), after.variants).catch(() => undefined);
    }, (error: unknown) => {
      if (!live) return;
      setListening((now) => ({ ...now, preparing: false }));
      update((kept) => recordFailure(kept, trial.id, error instanceof Error ? error.message : 'it could not be prepared'));
    });
    return () => { live = false; };
  }, [trial?.id, opened]);

  const open = async (): Promise<boolean> => {
    setProblem('');
    setOpening(true);
    const refusal = await room.open();
    setOpening(false);
    if (refusal) {
      setProblem(refusal);
      return false;
    }
    setOpened(true);
    return true;
  };

  const start = async () => {
    const kept = latest.current;
    if (!kept) return;
    if (!(await open())) return;
    saveSession(storage(), kept);
    setScreen(kept.position >= kept.trials.length ? 'reveal' : 'trial');
  };

  const play = (label: Label) => {
    const kept = latest.current;
    const now = kept?.trials[kept.position];
    if (!kept || !now || shellPlaying) return;
    const variant = variantOf(now, label);
    update((held) => countReplay(held, now.id, label));
    setListening((state) => ({ ...state, label, progress: null }));
    announce(`Playing ${label}`);
    if (variant.kind !== 'live') {
      update((held) => recordFailure(held, now.id, 'this version of the Listening Room plays only live transitions'));
      setListening((state) => ({ ...state, label: null, last: label }));
      return;
    }
    let crossed = false;
    void room.play(pairOf(now, mix), variant, label, (progress) => {
      if (progress.markKnown && !crossed && progress.elapsed >= progress.mark) {
        crossed = true;
        announce(`${label}: the transition is starting`);
      }
      setListening((state) => (state.label === label ? { ...state, progress } : state));
    }, now.variants).then((end: AuditionEnd) => {
      setListening((state) => (state.label === label ? { ...state, label: null, progress: null, last: label } : state));
      if (end.played.kind !== 'not_reached') update((held) => recordPlayed(held, now.id, label, end.played));
      else if (end.problem && !end.interrupted) update((held) => recordFailure(held, now.id, end.problem!));
      if (!end.interrupted) announce(end.problem ? `${label} stopped. ${end.problem}` : `${label} finished`);
    });
  };

  const toggle = () => {
    if (listening.label) {
      const playing = room.togglePause();
      setListening((state) => (state.progress ? { ...state, progress: { ...state.progress, phase: playing ? 'playing' : 'paused' } } : state));
    } else play(listening.last ?? 'A');
  };

  const leaveTrial = () => {
    room.stop();
    setListening({ label: null, progress: null, preparing: false, last: null });
  };
  const move = (to: number) => {
    leaveTrial();
    update((kept) => goTo(kept, to));
    const kept = latest.current;
    if (kept) setScreen(kept.position >= kept.trials.length ? 'reveal' : 'trial');
  };
  const forward = () => {
    const kept = latest.current;
    if (!kept) return;
    move(kept.position + 1 < kept.trials.length ? kept.position + 1 : nextOpen(kept));
  };
  const fresh = () => {
    room.stop();
    leaveSession(storage(), workspaceId);
    setResumed(false);
    setScreen('start');
    latest.current = null;
    setSession(null);
  };

  const levelCheck = () => {
    if (check) return room.stop();
    const first = latest.current?.trials[0];
    if (!first || shellPlaying) return;
    setCheck({ phase: 'loading', label: 'check', elapsed: 0, total: 1, mark: 1, markKnown: false });
    void room.levelCheck({ songId: first.from.songId, title: first.from.title }, setCheck).then((end) => {
      setCheck(null);
      if (end.problem && !end.interrupted) setProblem(end.problem);
      else setOpened(true);
    });
  };

  const body = (): ReactNode => {
    if (!soundHere()) {
      return <Note title="This browser can’t play the Listening Room">Listening here needs a browser that can play and mix your songs itself. Try a current Chrome, Edge, Firefox or Safari on a computer.</Note>;
    }
    if (screen === 'reveal' && session) return <RevealScreen session={session} onBack={() => move(session.trials.length - 1)} onNew={fresh} />;
    if (screen === 'trial' && session && trial) {
      const answer = answerOf(session, trial.id);
      const last = session.position + 1 >= session.trials.length;
      const done = answer.verdict && session.trials.every((other) => other.id === trial.id || answerOf(session, other.id).verdict);
      return (
        <TrialScreen
          trial={trial}
          answer={answer}
          number={session.position + 1}
          count={session.trials.length}
          nextWords={last && done ? 'See the results' : 'Next'}
          listening={listening}
          blocked={shellPlaying}
          onPlay={play}
          onToggle={toggle}
          onReplay={() => play(listening.label ?? listening.last ?? 'A')}
          onVerdict={(verdict) => update((kept) => chooseVerdict(kept, trial.id, verdict))}
          onReason={(reason) => update((kept) => toggleReason(kept, trial.id, reason))}
          onNote={(note) => update((kept) => setNote(kept, trial.id, note))}
          onBack={() => move(session.position - 1)}
          onSkip={() => move(session.position + 1 < session.trials.length ? session.position + 1 : nextOpen(session))}
          onNext={forward}
          onStop={() => { leaveTrial(); setResumed(true); setScreen('start'); }}
        />
      );
    }
    if (loading || (!session && !playable)) return <Skeleton variant="rows" lines={3} label="Checking which songs in your mix are on this device" />;
    if (!session) {
      return !mix.length
        ? <Note title="There’s no mix to listen to yet" actions={<Go to="/mixes" primary>Make a Mix</Go>}>The Listening Room plays transitions from your current mix. Make a mix, then come back here.</Note>
        : <Note title="Not enough of this mix is on this device" actions={<><Go to="/mixes" primary>Make a Mix</Go><Go to="/library">Library</Go></>}>The Listening Room needs two songs next to each other in your mix that are on this device. Connect your music in Library, or make a mix from the songs this device has.</Note>;
    }
    return (
      <StartScreen
        session={session}
        resumed={resumed}
        check={check}
        volume={volume}
        blocked={shellPlaying}
        problem={problem}
        opening={opening}
        onCheck={levelCheck}
        onVolume={(next) => { setVolume(next); try { storage()?.setItem(VOLUME_KEY, String(next)); } catch { /* this visit only */ } }}
        onStart={() => void start()}
        onNew={fresh}
        onPauseMix={() => void pauseShell()}
      />
    );
  };

  return (
    <main className="page lr-page" id="main" data-place="listening_room">
      <h1 className="display small">Listening Room</h1>
      {body()}
    </main>
  );
}
