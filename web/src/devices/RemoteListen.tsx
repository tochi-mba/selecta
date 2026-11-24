import { useEffect, useId, useRef, useState } from 'react';
import { PageLink } from '../shell/PageLink';
import { Icon } from '../ui/Icon';
import { OPTIMISTIC_MS, speakerOutput } from './PlayingBar';
import { advancing, clock, soundWords, stateWords, upNext, whereWords } from './remoteNow';
import type { Remote } from './useRemote';
import { askWords, stillAsking, type AskState } from './playOn';
import { bestHolder, notOn, type DeviceHolding } from './controller';
import { holdingWords } from './ControllerListen';
import { NO_SPEAKER_WORDS } from './usePlaybackDevice';
import { countOf } from '../ui/format';
import './devices.css';

// Listen on a device that is not the speaker (flag `devices.remote_control`): what is playing on
// the other device, where it has got to, and the controls that steer it. It needs no music on
// this device: titles come from the account's library, and every press is a playback command
// the speaker applies. Presses that wait or were missed are said by ControllerNotices, in the
// shell's banner, as on every other page.

/** One value a slider is being dragged to, sent once when the drag ends. */
function useRelease(send: (value: number) => void) {
  const pending = useRef<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const move = (value: number) => { pending.current = value; setDragged(value); };
  const release = () => {
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    setDragged(null);
    send(value);
  };
  return { dragged, move, release };
}

/** ADR-0475 R1: the speaker is away, or a press found nobody playing, so the device in hand
 * offers every way on from here: each open device of the person's with music, by R1, and this
 * device itself when it holds songs of the programme. */
export type PlayWays = {
  devices: readonly DeviceHolding[];
  asking: AskState;
  onPlayOn: (device: DeviceHolding) => void;
  /** Songs of the programme this device holds now; 0 offers no "Play here". */
  hereSongs: number;
  onPlayHere: () => void;
  /** The server's time, for "last open". */
  now: number;
};

export function RemoteListen({ remote, playableHere, ways, refusal, speakerSongs }: {
  remote: Remote;
  /** How many songs this device could play itself; none makes it a remote and nothing more. */
  playableHere: number;
  ways?: PlayWays | null;
  /** What the last press was told when the session did not take it. */
  refusal?: string;
  /** R3: the songs the speaker reported it can open; null when it has not said. */
  speakerSongs?: ReadonlySet<number> | null;
}) {
  const { view, session, current } = remote;
  const nextId = useId();
  const moving = advancing(view, session);
  // the position moves from the session's anchor; no request is made for it
  const [, tick] = useState(0);
  useEffect(() => {
    if (!moving) return undefined;
    const timer = window.setInterval(() => tick((count) => count + 1), 500);
    return () => window.clearInterval(timer);
  }, [moving]);

  // A seek or a volume change shows where it was put until the speaker's next report (a newer
  // seq), or for as long as a press may take to be applied; then the session speaks again.
  const [sought, setSought] = useState<{ ms: number; seq: number; index: number } | null>(null);
  const [level, setLevel] = useState<{ percent: number; seq: number } | null>(null);
  useEffect(() => {
    if (!sought && !level) return undefined;
    const timer = window.setTimeout(() => { setSought(null); setLevel(null); }, OPTIMISTIC_MS);
    return () => window.clearTimeout(timer);
  }, [sought, level]);
  const seek = useRelease((ms) => {
    setSought({ ms, seq: session.seq, index: session.song_index });
    void remote.seekTo(session.song_index, ms);
  });
  const volume = useRelease((percent) => {
    setLevel({ percent, seq: session.seq });
    void remote.setVolume(percent);
  });

  const duration = current.durationMs;
  const held = sought && sought.seq === session.seq && sought.index === session.song_index ? sought.ms : null;
  const position = seek.dragged ?? held ?? remote.positionMs();
  const reportedVolume = typeof session.volume === 'number' && Number.isFinite(session.volume) ? Math.round(session.volume) : null;
  const shownVolume = volume.dragged ?? (level && level.seq === session.seq ? level.percent : reportedVolume);
  // said about the speaker, by name: this device cannot play its check tone
  const sound = soundWords(view, speakerOutput(session));
  const state = stateWords(view, session);
  const coming = upNext(session, remote.book);
  const playLabel = remote.playing ? 'Pause' : 'Play';

  return (
    <main className="page remote-listen" id="main" data-speaker={view.speaker} data-state={session.state}>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="display small">Listen</h1>
        </div>
      </header>
      <div className="remote-layout">
        <section className="remote-card" aria-label="Remote control">
          <p className="remote-where" data-testid="remote-where"><Icon name={view.speaker === 'offline' ? 'warning' : 'music'} size="compact" />{whereWords(view)}</p>
          <div className="remote-song">
            <h2 dir="auto" data-testid="remote-title">{current.title}</h2>
            {current.artist && <p dir="auto" data-testid="remote-artist">{current.artist}</p>}
            {current.known && <p className="remote-place">Song {session.song_index + 1} of {session.programme.length}</p>}
          </div>
          {state && <p className="remote-state" role="status" data-testid="remote-state">{state}</p>}
          {sound && <p className="remote-sound" role="status" data-testid="remote-sound">{sound}</p>}
          {refusal && <p className="remote-refusal" role="alert" data-testid="remote-refusal">{refusal}</p>}
          {ways && (view.speaker === 'offline' || refusal === NO_SPEAKER_WORDS) && <WaysOn ways={ways} total={session.programme.length} />}
          <div className="remote-seek">
            {duration !== null ? (
              <input
                type="range"
                aria-label="Position in the song"
                aria-valuetext={`${clock(position)} of ${clock(duration)}`}
                min={0}
                max={duration}
                step={1000}
                value={Math.min(position, duration)}
                onChange={(event) => seek.move(Number(event.target.value))}
                onPointerUp={seek.release}
                onTouchEnd={seek.release}
                onKeyUp={seek.release}
                onBlur={seek.release}
              />
            ) : (
              // the library has no length for this song, so there is nothing true to drag along
              <p className="remote-no-length">This song’s length isn’t known here, so it can’t be moved through.</p>
            )}
            <p className="remote-times">
              <span data-testid="remote-elapsed">{clock(position)}</span>
              {duration !== null && <span data-testid="remote-total">{clock(duration)}</span>}
            </p>
          </div>
          <div className="remote-transport" role="group" aria-label="Playback controls">
            <button type="button" className="remote-step" onClick={() => void remote.previous()} aria-label="Previous" title="Previous"><Icon name="previous" /></button>
            <button type="button" className="remote-play primary" onClick={() => void remote.toggle()} aria-label={playLabel} title={playLabel}><Icon name={remote.playing ? 'pause' : 'play'} size="hero" /></button>
            <button type="button" className="remote-step" onClick={() => void remote.next()} disabled={!remote.hasNext} aria-label="Next song" title="Next song"><Icon name="next" /></button>
          </div>
          {shownVolume !== null && (
            <label className="remote-volume">
              <Icon name={shownVolume === 0 ? 'muted' : 'volume'} />
              <input
                type="range"
                aria-label="Volume"
                aria-valuetext={`${shownVolume} percent`}
                min={0}
                max={100}
                value={shownVolume}
                onChange={(event) => volume.move(Number(event.target.value))}
                onPointerUp={volume.release}
                onTouchEnd={volume.release}
                onKeyUp={volume.release}
                onBlur={volume.release}
              />
            </label>
          )}
        </section>
        <div className="remote-side">
          {coming.length > 0 && (
            <section className="remote-next" aria-labelledby={nextId}>
              <h2 id={nextId}>Up next</h2>
              <ol>
                {coming.map((entry) => (
                  <li key={entry.index}>
                    <button type="button" onClick={() => void remote.skipTo(entry.index)} title={`Play ${entry.title} now`}>
                      <span className="remote-next-place" aria-hidden="true">{entry.index + 1}</span>
                      <span className="remote-next-words"><b dir="auto">{entry.title}</b>{entry.artist && <span dir="auto">{entry.artist}</span>}{speakerSongs && !speakerSongs.has(entry.songId) && <span className="remote-next-missing" data-testid="not-on-speaker">{notOn(view.speaker_name ?? 'the speaker')}</span>}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <p className="remote-device" data-testid="remote-device">
            {playableHere > 0
              ? <>This device is working as a remote. To play here instead, <PageLink to="/mixes">make a mix on this device</PageLink>.</>
              : <>This device has no music on it, so it works as a remote. <PageLink to="/library">Connect music</PageLink></>}
          </p>
        </div>
      </div>
    </main>
  );
}

/** Each way to start the music from here: Play on each open device with music (the R1 best
 * first), and Play here when this device holds songs of the programme. */
function WaysOn({ ways, total }: { ways: PlayWays; total: number }) {
  const best = bestHolder(ways.devices);
  const open = ways.devices.filter((device) => device.online && device.songs > 0)
    .sort((one, other) => (one === best ? -1 : other === best ? 1 : other.songs - one.songs));
  const busy = stillAsking(ways.asking);
  return (
    <section className="remote-ways" aria-label="Play it somewhere else" data-testid="play-ways">
      {open.length > 0 || ways.hereSongs > 0 ? (
        <ul>
          {open.map((device) => (
            <li key={device.device_id}>
              <span className="controller-device-words"><b dir="auto">{device.name}</b><span>{holdingWords(device, ways.now)}</span></span>
              <button type="button" className={device === best ? 'primary' : undefined} disabled={busy} data-testid="play-on" onClick={() => ways.onPlayOn(device)}><Icon name="play" /> Play on {device.name}</button>
            </li>
          ))}
          {ways.hereSongs > 0 && (
            <li>
              <span className="controller-device-words"><b>This device</b><span>{ways.hereSongs >= total ? `All ${countOf(total, 'song')}` : `${ways.hereSongs} of ${countOf(total, 'song')}`}</span></span>
              <button type="button" className={open.length ? undefined : 'primary'} disabled={busy} data-testid="play-here" onClick={ways.onPlayHere}><Icon name="play" /> Play here</button>
            </li>
          )}
        </ul>
      ) : (
        <p className="remote-state" role="status" data-testid="play-ways-none">None of your other devices with music is open right now. Open SelectaDJ on one of them.</p>
      )}
      {ways.asking && <p className="controller-asking" role="status" data-testid="play-on-status" data-phase={ways.asking.phase}>{askWords(ways.asking.phase, ways.asking.device)}</p>}
    </section>
  );
}
