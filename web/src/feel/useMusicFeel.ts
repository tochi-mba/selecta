import { useEffect, useRef } from 'react';
import type { MixItem } from '../api';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { beatBusSync, startBeatBus } from './beatBus';
import { artHue, endTravel, handoverProgress, publishAmbientHue, travelAmbient } from './hue';
import { onFeelChange } from './root';

/** The shell's one hook for the music-reactive feel (ADR-0477 FL-0477-04).
 *
 * It points the beat bus at the player and keeps it in step with play and pause, publishes the
 * playing song's hue, and carries the ambient layer from one song's hue to the next during a real
 * hand-over, by the same progress the Listen hand-over bar draws (feel/hue.ts handoverProgress).
 * It renders nothing and holds no state, so it never causes a render of its own: it rides the
 * renders the shell already makes when the player's state changes.
 *
 * `next` is the song after `song`. Without it the hue still changes at each new song (the sheet
 * eases it), but it cannot travel during the hand-over, because the song coming in is unknown. */
export function useMusicFeel({ player, now, song, next }: {
  player: PlayerLike;
  now: NowState;
  song?: MixItem | null;
  next?: MixItem | null;
}) {
  useEffect(() => startBeatBus(player), [player]);

  // a pause stops the bus here as well as on its own next frame, so it settles at once
  const phase = now.phase;
  useEffect(() => {
    beatBusSync();
  }, [phase]);

  const songId = song?.song_id ?? null;
  const loaded = phase !== 'idle';
  useEffect(() => {
    const publish = () => publishAmbientHue(songId !== null && loaded ? artHue(songId) : null);
    publish();
    // ambient switched on or off (a flag, Still is not one of them, low power is)
    return onFeelChange(publish);
  }, [songId, loaded]);
  useEffect(() => () => publishAmbientHue(null), []);

  // the hand-over: only before the switch point, when the song coming in is the next one
  const travelled = useRef(false);
  const switchAt = next?.seam?.state.switch_at;
  const handing = now.inSeam && !now.seamTail && now.seamAt !== null && songId !== null && !!next && !!switchAt;
  useEffect(() => {
    if (handing && songId !== null && next && now.seamAt !== null) {
      travelled.current = true;
      travelAmbient(artHue(songId), artHue(next.song_id), handoverProgress(now.songTime, now.seamAt, switchAt));
    } else if (travelled.current) {
      travelled.current = false;
      endTravel();
    }
  });
}
