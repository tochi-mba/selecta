import { useEffect, useRef } from 'react';
import type { MixItem } from '../api';
import { coverHueForSong } from '../media/coverLadder';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { beatBusSync, startBeatBus } from './beatBus';
import { artHue, endTravel, handoverProgress, publishAmbientHue, travelAmbient } from './hue';
import { outputDelayMs, readOutputDelay, watchOutputDelay } from './outputDelay';
import { feelOn, onFeelChange } from './root';

/** Covers' own hues by song, as found; a song asked about once is not asked again this visit. A
 * short list is kept, since only the playing and next songs are ever needed. */
const coverHues = new Map<number, number>();
const asked = new Set<number>();
const KEPT_HUES = 64;
function remember(songId: number, hue: number) {
  coverHues.delete(songId);
  coverHues.set(songId, hue);
  if (coverHues.size > KEPT_HUES) coverHues.delete(coverHues.keys().next().value as number);
}
const hueOf = (songId: number) => coverHues.get(songId) ?? artHue(songId);

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
  useEffect(() => {
    const stopBus = startBeatBus(player);
    const stopDelay = watchOutputDelay(player);
    return () => { stopBus(); stopDelay(); };
  }, [player]);

  // a pause stops the bus here as well as on its own next frame, so it settles at once; playback
  // starting reads the speakers' lag again (feel/outputDelay.ts), so pulses land when heard
  const phase = now.phase;
  useEffect(() => {
    if (phase === 'playing') readOutputDelay(player);
    beatBusSync();
  }, [phase, player]);

  const songId = song?.song_id ?? null;
  const nextId = next?.song_id ?? null;
  const loaded = phase !== 'idle';
  // the room takes the cover's own colour where the song has a real cover (ADR-0478 FL-0478-05),
  // found on the same ladder as the cover on screen; until then, and without one, the tile's hue.
  // A hue found later is published straight from here, so this still never renders on its own.
  const playing = useRef({ songId, loaded });
  playing.current = { songId, loaded };
  useEffect(() => {
    for (const id of [songId, nextId]) {
      if (id === null || coverHues.has(id) || asked.has(id) || !feelOn('ambient')) continue;
      asked.add(id);
      void coverHueForSong(id).catch(() => null).then((hue) => {
        if (hue === null) return;
        remember(id, hue);
        if (playing.current.songId === id && playing.current.loaded) publishAmbientHue(hue);
      });
    }
  }, [songId, nextId]);
  useEffect(() => {
    const publish = () => publishAmbientHue(songId !== null && loaded ? hueOf(songId) : null);
    publish();
    // ambient switched on or off (a flag, Still is not one of them, low power is)
    return onFeelChange(publish);
  }, [songId, loaded]);
  useEffect(() => () => publishAmbientHue(null), []);

  // the hand-over: only before the switch point, when the song coming in is the next one
  const travelled = useRef(false);
  const switchAt = next?.seam?.state.switch_at ?? now.blend?.window;
  const handing = now.inSeam && !now.seamTail && now.seamAt !== null && songId !== null && !!next && !!switchAt;
  useEffect(() => {
    if (handing && songId !== null && next && now.seamAt !== null) {
      travelled.current = true;
      // by the song as heard, not the context clock, which runs ahead by the speakers' lag
      travelAmbient(hueOf(songId), hueOf(next.song_id), handoverProgress(now.songTime - outputDelayMs() / 1000, now.seamAt, switchAt));
    } else if (travelled.current) {
      travelled.current = false;
      endTravel();
    }
  });
}
