import { useEffect, useRef } from 'react';
import type { MixItem } from '../api';
import { audioOwner } from '../audio/focus';
import { bindMediaSession, syncMediaSession } from '../audio/mediaSession';
import type { NowState } from '../player';

/** The transport the keyboard's and the OS's media keys drive. */
export type MediaKeysPlayer = Parameters<typeof bindMediaSession>[1];

/** The media keys (play/pause, next, previous, seek) and what the OS shows as playing, for whichever
 * shell owns the player: the local app, the local-first shell, or hosted Cloud with a player of its
 * own. The keys are registered once while `on`; their handlers read live state, so they never act on
 * a stale song. What the OS shows is re-said on every change and once a second between (the OS
 * advances at rate 1 in between), and never names a preview as the mix. */
export function useMediaKeys({ on, player, getMix, mixName, now }: {
  on: boolean;
  player: MediaKeysPlayer | null;
  getMix: () => MixItem[];
  mixName: string;
  now: Pick<NowState, 'phase' | 'position'>;
}) {
  const mix = useRef(getMix);
  mix.current = getMix;
  const live = on && !!player && typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  useEffect(() => {
    if (!live || !player) return;
    return bindMediaSession(navigator.mediaSession, player, () => mix.current());
  }, [live, player]);

  const song = getMix()[now.position];
  useEffect(() => {
    if (!live || !player) return;
    const update = () => {
      const state = player.state;
      syncMediaSession(navigator.mediaSession, state, mix.current()[state.position], mixName, !!audioOwner());
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [live, player, now.phase, now.position, song?.song_id, song?.title, song?.artist, mixName]);
}
