import { useEffect, useMemo, useRef, useState } from 'react';
import { audioSpeaker } from './audioSpeaker';
import { Api, extrapolate, Speaker, usePlaybackDevice } from './usePlaybackDevice';
import './devices.css';

// The "Playing on ..." bar (ADR-0415): every device sees where the music is and can steer it.
// The speaker says "Playing here"; a remote says "Playing on Living-room laptop" with play,
// pause and skip, and offers Play here (asking first while the other device is online). An
// iPhone is told plainly to keep the screen on.

export type SongName = (index: number) => string | null;

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `remoteControl` off (the `devices.remote_control` flag): play, pause and skip are playback
 * commands, which the server then refuses, so they're gone; the bar still shows where the music
 * is and offers Play here, so each device plays on its own (docs/saas/11b-feature-flags.md). */
export function PlayingBar({ api, workspaceId, source, songName, remoteControl = true }: { api: Api; workspaceId: string; source: (index: number) => Promise<string | null>; songName?: SongName; remoteControl?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  useEffect(() => { if (audio.current) setSpeaker(audioSpeaker(audio.current, source)); }, [source]);
  const pb = usePlaybackDevice({ api, workspaceId, speaker });
  const [asking, setAsking] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);

  const view = pb.view;
  const session = view?.session ?? null;
  const here = pb.isSpeaker();
  const warning = pb.device?.warnings.find((w) => w.code === 'ios_keep_screen_on' || w.code === 'no_audio');
  const name = session ? songName?.(session.song_index) ?? `Song ${session.song_index + 1}` : null;
  const position = session ? extrapolate(session, pb.serverNow()) : 0;
  const playing = session?.state === 'playing';

  const where = useMemo(() => {
    if (!view) return 'Connecting...';
    if (here || view.speaker === 'here') return 'Playing here';
    if (view.speaker === 'elsewhere') return `Playing on ${view.speaker_name ?? 'another device'}`;
    if (view.speaker === 'offline') return `${view.speaker_name ?? 'The speaker'} is offline and may still be playing`;
    return 'Nothing is playing';
  }, [here, view]);

  const pressPlayHere = () => {
    if (view?.ask_before_playing_here && !asking) { setAsking(true); return; }
    setAsking(false);
    void pb.playHere();
  };
  const remote = remoteControl && (view?.speaker === 'elsewhere' || (here && Boolean(session)));

  return (
    <section className="playing-bar" aria-label="Playback">
      <audio ref={audio} data-testid="speaker-audio" preload="auto" />
      <div className="playing-bar-where">
        <strong data-testid="playing-where">{where}</strong>
        {name && session?.state !== 'stopped' && <span className="playing-bar-song">{name} · {clock(position)}</span>}
      </div>
      <div className="playing-bar-controls">
        {remote && session && (
          <>
            <button type="button" onClick={() => void pb.command(playing ? 'pause' : 'play')} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={() => void pb.command('skip')}>Skip</button>
          </>
        )}
        {!here && !pb.starting && (
          <button type="button" className="primary" onClick={pressPlayHere} disabled={!pb.device || !speaker}>Play here</button>
        )}
      </div>
      {asking && (
        <div className="playing-bar-ask" role="alertdialog" aria-label="Move playback here?">
          <span>{`Playing on ${view?.speaker_name ?? 'another device'}. Play here instead?`}</span>
          <button type="button" className="primary" onClick={pressPlayHere}>Play here instead</button>
          <button type="button" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
      {warning && (here || pb.starting || asking) && <p className="playing-bar-warning" role="note">{warning.text}</p>}
      <p className="playing-bar-message" role="status">{pb.message || pb.notice}</p>
      {pb.error && <p className="playing-bar-error" role="alert">{pb.error}</p>}
    </section>
  );
}
