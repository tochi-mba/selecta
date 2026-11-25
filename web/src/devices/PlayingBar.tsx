import { useEffect, useMemo, useRef, useState } from 'react';
import { audioSpeaker } from './audioSpeaker';
import { ControllerNotices } from './ControllerNotices';
import { PlaybackStatus, playbackStatusText } from '../copy';
import { Action } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ELLIPSIS } from '../ui/format';
import { Api, extrapolate, HEARTBEAT_MS, REMOTE_POLL_MS, SessionState, Speaker, usePlaybackDevice } from './usePlaybackDevice';
import { whereWords } from './remoteNow';
import { CoverArt } from '../views/CoverArt';
import { useFeelPart } from '../rooms/feelHooks';
import './devices.css';

// The "Playing on ..." bar (ADR-0415): every device sees where the music is and can steer it.
// The speaker says "Playing here"; a remote says "Playing on Living-room laptop" with play,
// pause and skip, and offers Play here (asking first while the other device is online). An
// iPhone is told plainly to keep the screen on.

export type SongName = (index: number) => string | null;

/** The speaker's reported output as the shared PLAYBACK_STATUS vocabulary, or null. */
export function speakerOutput(session: SessionState | null): PlaybackStatus | null {
  const status = session?.output_status;
  if (!status) return null;
  if (status === 'playing') return typeof session?.output_verified_at === 'number' ? { state: 'playing', verifiedAt: session.output_verified_at } : { state: 'output_unverified' };
  return { state: status };
}

/** How long a pressed play/pause is shown before the bar falls back to what the speaker reports.
 * An online speaker applies a command within one heartbeat and a remote sees it within one poll;
 * past that the press was accepted but never applied (an offline speaker), so the button must
 * stop claiming it. */
export const OPTIMISTIC_MS = HEARTBEAT_MS + REMOTE_POLL_MS;

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `remoteControl` off (the `devices.remote_control` flag): play, pause and skip are playback
 * commands, which the server then refuses, so they're gone; the bar still shows where the music
 * is and offers Play here, so each device plays on its own (docs/saas/11b-feature-flags.md). */
/** `speakerFor` builds the speaker from the bar's element; the Cloud dock passes one that
 * recovers from media failures (ADR-0419). Left out, it is the plain speaker, as before. */
export function PlayingBar({ api, workspaceId, source, songName, remoteControl = true, speakerFor = audioSpeaker }: { api: Api; workspaceId: string; source: (index: number) => Promise<string | null>; songName?: SongName; remoteControl?: boolean; speakerFor?: (audio: HTMLAudioElement, source: (index: number) => Promise<string | null>) => Speaker }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  useEffect(() => { if (audio.current) setSpeaker(speakerFor(audio.current, source)); }, [source, speakerFor]);
  const pb = usePlaybackDevice({ api, workspaceId, speaker, remoteControl });
  const [asking, setAsking] = useState(false);
  const [observedOwner, setObservedOwner] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Optimistic play/pause: the bar shows the press at once, tied to the session seq it was based
  // on. A newer seq from the server replaces it; a refusal takes it back straight away; and a press
  // the speaker never applies lapses after OPTIMISTIC_MS, back to the reported state.
  const [wanted, setWanted] = useState<{ playing: boolean; seq: number } | null>(null);
  const [, tick] = useState(0);
  // ADR-0477: with depth on, the playing song's cover sits beside its name; no beat effects, as
  // this bar may be a remote with no sound to measure
  const covers = useFeelPart('depth');
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);

  const view = pb.view;
  const session = view?.session ?? null;
  const here = pb.isSpeaker();
  const warning = pb.device?.warnings.find((w) => w.code === 'ios_keep_screen_on' || w.code === 'no_audio');
  const name = session ? songName?.(session.song_index) ?? `Song ${session.song_index + 1}` : null;
  const position = session ? extrapolate(session, pb.serverNow()) : 0;
  const songId = session ? session.track?.song_id ?? session.programme?.[session.song_index]?.song_id : undefined;
  const shownWanted = wanted && session && session.seq === wanted.seq ? wanted : null;
  const playing = shownWanted ? shownWanted.playing : session?.state === 'playing';
  useEffect(() => { if (wanted && session && session.seq !== wanted.seq) setWanted(null); }, [session, wanted]);
  useEffect(() => {
    if (!wanted) return;
    const t = window.setTimeout(() => setWanted((now) => (now === wanted ? null : now)), OPTIMISTIC_MS);
    return () => window.clearTimeout(t);
  }, [wanted]);
  const steer = async (name: 'play' | 'pause') => {
    if (session) setWanted({ playing: name === 'play', seq: session.seq });
    const ok = await pb.send(name);
    if (!ok) setWanted(null);
  };

  const where = useMemo(() => {
    if (!view) return `Connecting${ELLIPSIS}`;
    // This device knows its own speaker is running; anyone else only knows what the server last
    // heard, so a lapsed lease (state_confidence uncertain, ADR-0461) is never shown as playing.
    if (here) return 'Playing here';
    // The server already judged the lease lapsed: say plainly the speaker is offline.
    if (view.speaker === 'offline') return `${view.speaker_name ?? 'The speaker'} is offline and may still be playing`;
    if (session?.state_confidence === 'uncertain') {
      return `${view.speaker_name ?? 'The speaker'} has not checked in recently and may still be playing`;
    }
    if (view.speaker === 'here') return 'Playing here';
    // ADR-0475 R9: the same words as the remote's Listen (Playing, Paused or Stopped on {device})
    if (view.speaker === 'elsewhere') return whereWords(view);
    return 'Nothing is playing';
  }, [here, session?.state_confidence, view]);

  const pressPlayHere = async () => {
    if (asking) {
      setAsking(false);
      // Transfer only the lease the listener actually confirmed. A third device may
      // have become the speaker while the dialog was open.
      await pb.playHere(observedOwner);
      return;
    }
    // The other browser may have acquired the lease since our last poll. A click must
    // check the server, not silently bypass the transfer confirmation with a stale view.
    setChecking(true);
    try {
      const latest = await pb.refreshSession();
      if (!latest) return; // The hook reports a connectivity or authorization problem.
      if (latest.ask_before_playing_here) {
        setObservedOwner(latest.speaker_device_id);
        setAsking(true);
        return;
      }
      // No remote owner was observed; reject an unexpected live owner under the
      // backend's session lock instead of skipping the confirmation.
      await pb.playHere(null);
    } finally {
      setChecking(false);
    }
  };
  // An offline speaker can still be steered: the press is held and reaches it if it comes back
  // in time, or is shown as missed (BF-0461-04), so the buttons stay.
  const remote = remoteControl && (view?.speaker === 'elsewhere' || view?.speaker === 'offline' || (here && Boolean(session)));
  // What the speaker says about its sound output (BF-0457-03). Only a browser-engine speaker
  // reports one, so with that player off nothing renders here.
  const output = !here ? speakerOutput(session) : null;

  return (
    <section className="playing-bar" aria-label="Playback">
      <audio ref={audio} data-testid="speaker-audio" preload="auto" />
      <div className="playing-bar-where">
        <strong data-testid="playing-where">{where}</strong>
        {covers && name && session?.state !== 'stopped' && songId !== undefined && <CoverArt seed={songId} songId={songId} size="small" />}
        {name && session?.state !== 'stopped' && <span className="playing-bar-song">{name} · {clock(position)}</span>}
      </div>
      <div className="playing-bar-controls">
        {remote && session && (
          <>
            <Action type="button" run={() => steer(playing ? 'pause' : 'play')} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</Action>
            <Action type="button" run={() => pb.command('skip')}>Skip</Action>
          </>
        )}
        {!here && !pb.starting && (
          <button type="button" className="primary" onClick={() => void pressPlayHere()} disabled={!pb.device || !speaker || checking}>Play here</button>
        )}
      </div>
      {asking && (
        <ConfirmDialog
          title="Move playback here?"
          body={`Playing on ${view?.speaker_name ?? 'another device'}. Play here instead?`}
          confirmLabel="Play here instead"
          cancelLabel="Cancel"
          working={`Moving${ELLIPSIS}`}
          onConfirm={pressPlayHere}
          onClose={() => setAsking(false)}
        />
      )}
      {output && <p className="playing-bar-output" data-testid="speaker-output">{playbackStatusText(output)}</p>}
      {remoteControl && !here && (
        <ControllerNotices notices={view?.notices} speakerName={view?.speaker_name ?? null} session={session} send={(name, args) => void pb.command(name, args)} />
      )}
      {warning && (here || pb.starting || asking) && <p className="playing-bar-warning" role="note">{warning.text}</p>}
      <p className="playing-bar-message" role="status">{pb.message || pb.notice}</p>
      {pb.error && <p className="playing-bar-error" role="alert">{pb.error}</p>}
    </section>
  );
}
