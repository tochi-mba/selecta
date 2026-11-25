// The hosted dock's small transport (ADR-0477, plan 3.4): Play or Pause, where in the song, and the
// time, in SelectaDJ's own look instead of the browser's audio widget. It drives the dock's own
// <audio> element and reads its clock from that element's events (cloud/CloudTransportDock.tsx), so
// what it shows is what the element is doing. Fully keyboard operable: a button and a native range.
// Nothing here answers the beat; the hosted element cannot be measured safely.
import { RefObject, useId } from 'react';
import { transportClock } from '../audio/transportWords';
import { Icon } from '../ui/Icon';

export type DockClock = { time: number; duration: number; playing: boolean };

export function DockTransport({ audio, clock }: { audio: RefObject<HTMLAudioElement | null>; clock: DockClock }) {
  const timeId = useId();
  const known = clock.duration > 0;
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    // the same calls the browser's own Play button makes; a refused play() leaves it paused
    if (element.paused || element.ended) void element.play().catch(() => undefined);
    else element.pause();
  };
  const seek = (seconds: number) => {
    const element = audio.current;
    if (element && Number.isFinite(seconds)) element.currentTime = seconds;
  };
  return (
    <div className="dock-transport" role="group" aria-label="Playback">
      <button type="button" className="dock-transport-play" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={toggle}>
        <span className="play-morph" data-state={clock.playing ? 'pause' : 'play'} aria-hidden="true">
          <Icon name="play" className="play-morph-play" />
          <Icon name="pause" className="play-morph-pause" />
        </span>
      </button>
      <input type="range" className="dock-transport-seek" aria-label="Where in the song" aria-describedby={timeId}
        min={0} max={known ? Math.round(clock.duration) : 0} step={1} value={known ? Math.min(Math.round(clock.time), Math.round(clock.duration)) : 0}
        disabled={!known}
        aria-valuetext={known ? `${transportClock(clock.time)} of ${transportClock(clock.duration)}` : 'Duration unknown'}
        onChange={(event) => seek(Number(event.currentTarget.value))} />
      <span className="dock-transport-time" id={timeId}>{transportClock(clock.time)} / {known ? transportClock(clock.duration) : '--:--'}</span>
    </div>
  );
}
