import { useEffect, useRef, useState } from 'react';
import { releaseAudio, takeAudio } from '../audio/focus';

let nextId = 1;

/** A clip with its own controls. Pressing play takes the sound from whatever had it, and when it's
 * done, or this goes away, the sound is given back. */
export function AudioPreview({ src, startAt, autoPlay, label = 'A preview' }: { src: string; startAt?: number; autoPlay?: boolean; label?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [problem, setProblem] = useState('');
  const id = useRef(`clip-${nextId++}`);

  useEffect(() => {
    setProblem('');
    const element = audio.current;
    if (!element || (!autoPlay && startAt === undefined)) return;
    let live = true;
    const go = () => {
      if (startAt !== undefined) element.currentTime = Math.max(0, startAt);
      if (autoPlay) {
        void Promise.resolve(element.play()).catch((error: Error) => {
          // being stopped or replaced on the way isn't the preview failing
          if (live && error?.name !== 'AbortError') setProblem('Preview did not start. Press play to try again.');
        });
      }
    };
    if (element.readyState > 0) go();
    else element.addEventListener('loadedmetadata', go, { once: true });
    return () => {
      live = false;
      element.removeEventListener('loadedmetadata', go);
    };
  }, [src, startAt, autoPlay]);

  useEffect(() => {
    const mine = id.current;
    return () => {
      audio.current?.pause();
      releaseAudio(mine);
    };
  }, []);

  return (
    <div className="preview-region">
    <audio
      ref={audio}
      controls
      src={src}
      className="preview"
      aria-label={label}
      onError={() => { releaseAudio(id.current); setProblem('This preview could not be loaded. Try loading it again.'); }}
      onPlay={() => { setProblem(''); takeAudio({ id: id.current, label, stop: () => audio.current?.pause() }); }}
      onPause={() => releaseAudio(id.current)}
      onEnded={() => releaseAudio(id.current)}
    />
    {problem && <div className="warn" role="alert"><p>{problem}</p><button onClick={() => { setProblem(''); audio.current?.load(); }}>Reload preview</button></div>}
    </div>
  );
}
