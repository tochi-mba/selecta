import { useCallback, useEffect, useRef, useState } from 'react';
import { sayThisTabIsPlaying } from '../state/tabs';

/** Only one thing makes a sound at a time. The mix is one owner, and everything you can audition is
 * another: a transition, a bridge, a chord demo, the Studio, a listening test. Starting a preview
 * pauses the mix, and when the preview ends the mix carries on, unless the person has since paused,
 * played or moved on themselves, in which case what they did stands. The states and rules are written
 * out in docs/adr/selecta-3-audio.md. */

export type AudioOwner = {
  id: string;
  label: string;
  stop: () => void;
};

type MainPlayer = {
  isPlaying: () => boolean;
  pause: () => Promise<void> | void;
  resume: () => Promise<void> | void;
};

let main: MainPlayer | null = null;
let owner: AudioOwner | null = null;
let resumeAfter = false;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** The mix player, once it exists. */
export function connectMainPlayer(player: MainPlayer | null) {
  main = player;
}

/** Someone pressed play or pause themselves, so nothing should undo that later. */
export function mainPlayerTouched() {
  resumeAfter = false;
}

export function audioOwner(): AudioOwner | null {
  return owner;
}

/** Take over the sound. Whoever had it stops, and the mix pauses if it was playing. */
export function takeAudio(next: AudioOwner) {
  if (owner && owner.id !== next.id) {
    const before = owner;
    owner = null;
    before.stop();
  }
  owner = next;
  if (main?.isPlaying()) {
    resumeAfter = true;
    void main.pause();
  }
  // a preview here shouldn't play over the mix in another tab either
  sayThisTabIsPlaying();
  changed();
}

/** Give it back. With `finished` false, it was stopped on the way somewhere else, so whether the mix
 * carries on is still decided by what the person did last. */
export function releaseAudio(id: string) {
  if (owner?.id !== id) return;
  owner = null;
  if (resumeAfter) {
    resumeAfter = false;
    void main?.resume();
  }
  changed();
}

/** Stop any preview without the mix coming back, for when someone chooses to leave it paused. */
export function stopPreviewsOnly() {
  resumeAfter = false;
  if (owner) {
    const before = owner;
    owner = null;
    before.stop();
    changed();
  }
}

let shared: HTMLAudioElement | null = null;
function element(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio();
    shared.preload = 'none';
  }
  return shared;
}

export type Preview = {
  /** What's playing, by the key it was asked for with. */
  playing: string;
  problem: string;
  play: (key: string, src: string, label?: string) => void;
  stop: () => void;
  toggle: (key: string, src: string, label?: string) => void;
};

let nextPreviewId = 1;

/** One audition control's sound. There's only ever one element for all of them, which is what stops
 * two from overlapping, and leaving the page they're on lets the sound go. */
export function usePreview(): Preview {
  const id = useRef(`preview-${nextPreviewId++}`);
  // which press of play this is. Something still arriving from an older one can't touch a newer one
  const session = useRef(0);
  const [playing, setPlaying] = useState('');
  const [problem, setProblem] = useState('');

  const stopHere = useCallback(() => {
    session.current += 1;
    const audio = element();
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    setPlaying('');
  }, []);

  const play = useCallback((key: string, src: string, label = 'A preview') => {
    setProblem('');
    takeAudio({ id: id.current, label, stop: stopHere });
    session.current += 1;
    const mine = session.current;
    const audio = element();
    audio.pause();
    audio.src = src;
    audio.onended = () => {
      if (mine !== session.current) return;
      setPlaying('');
      releaseAudio(id.current);
    };
    audio.onerror = () => {
      if (mine !== session.current) return;
      setPlaying('');
      setProblem('That couldn’t be played.');
      releaseAudio(id.current);
    };
    setPlaying(key);
    void Promise.resolve(audio.play()).catch((error: Error) => {
      // Changing the clip cancels the play before it. That's not a failure, and giving the sound back
      // here would bring the mix in underneath the clip that replaced it.
      if (mine !== session.current || error?.name === 'AbortError') return;
      setPlaying('');
      setProblem('That couldn’t be played.');
      releaseAudio(id.current);
    });
  }, [stopHere]);

  const stop = useCallback(() => {
    stopHere();
    releaseAudio(id.current);
  }, [stopHere]);

  const toggle = useCallback((key: string, src: string, label?: string) => {
    if (playing === key) stop();
    else play(key, src, label);
  }, [play, playing, stop]);

  useEffect(() => () => {
    if (audioOwner()?.id === id.current) {
      stopHere();
      releaseAudio(id.current);
    }
  }, [stopHere]);

  return { playing, problem, play, stop, toggle };
}
