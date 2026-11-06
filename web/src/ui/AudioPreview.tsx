import { useEffect, useRef } from 'react';
import { releaseAudio, takeAudio } from '../audio/focus';

let nextId = 1;

/** A clip with its own controls. Pressing play takes the sound from whatever had it, and when it's
 * done, or this goes away, the sound is given back. */
export function AudioPreview({ src, startAt, autoPlay, label = 'A preview' }: { src: string; startAt?: number; autoPlay?: boolean; label?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const id = useRef(`clip-${nextId++}`);

  useEffect(() => {
    const element = audio.current;
    if (!element || (!autoPlay && startAt === undefined)) return;
    const go = () => {
      if (startAt !== undefined) element.currentTime = Math.max(0, startAt);
      if (autoPlay) void Promise.resolve(element.play()).catch(() => {});
    };
    if (element.readyState > 0) go();
    else element.addEventListener('loadedmetadata', go, { once: true });
    return () => element.removeEventListener('loadedmetadata', go);
  }, [src, startAt, autoPlay]);

  useEffect(() => {
    const mine = id.current;
    return () => {
      audio.current?.pause();
      releaseAudio(mine);
    };
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio
      ref={audio}
      controls
      src={src}
      className="preview"
      aria-label={label}
      onPlay={() => takeAudio({ id: id.current, label, stop: () => audio.current?.pause() })}
      onPause={() => releaseAudio(id.current)}
      onEnded={() => releaseAudio(id.current)}
    />
  );
}
