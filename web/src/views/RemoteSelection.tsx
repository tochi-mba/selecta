import { useState } from 'react';
import type { LibrarySong } from '../api';
import { MOVE_NOW_EVENT, type MoveOffer, type MusicHolder } from '../devices/controller';

// ADR-0475 I88: songs chosen on a remote, some on the speaker and some only elsewhere. Before
// anything happens the bar says what will: "9 of 12 can play on Laptop. 3 are only on Phone.",
// with "Play the 9" (next on the speaker, in the order chosen) and "Choose another device"
// (each open device that has some of them, which then plays those and takes the music over).

/** The split of a selection by where it can play. */
export function splitSelection(songs: readonly LibrarySong[], holder: MusicHolder) {
  const held = songs.filter((song) => !holder.ids || holder.ids.has(song.id));
  const rest = songs.filter((song) => holder.ids && !holder.ids.has(song.id));
  const elsewhere = new Map<string, LibrarySong[]>();
  for (const song of rest) {
    const device = holder.places?.(song.id).online.find((name) => name !== holder.name);
    if (device) elsewhere.set(device, [...(elsewhere.get(device) ?? []), song]);
  }
  const firstAway = rest.map((song) => holder.places?.(song.id).online[0] ?? holder.places?.(song.id).before[0]).find(Boolean) ?? null;
  return { held, rest, elsewhere, firstAway };
}

export function selectionWords(held: number, total: number, speaker: string, restOn: string | null): string {
  const away = total - held;
  if (!away) return '';
  const first = `${held} of ${total} can play on ${speaker}.`;
  const second = `${away} ${away === 1 ? 'is' : 'are'} only on ${restOn ?? 'no open device'}.`;
  return `${first} ${second}`;
}

export function RemoteSelection({ songs, holder, playNext, disabled }: {
  songs: readonly LibrarySong[];
  holder: MusicHolder;
  /** Put these songs next on the speaker, in this order. */
  playNext: (songs: readonly LibrarySong[]) => Promise<void>;
  disabled: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [asked, setAsked] = useState(false);
  const { held, elsewhere, firstAway } = splitSelection(songs, holder);
  const words = selectionWords(held.length, songs.length, holder.name, firstAway);
  const play = async () => { await playNext(held); setAsked(false); };
  if (!words) {
    return <button type="button" disabled={disabled || !held.length} onClick={() => void play()}>Play next on {holder.name}</button>;
  }
  if (!asked) return <button type="button" disabled={disabled} onClick={() => setAsked(true)}>Play next on {holder.name}</button>;
  return (
    <span className="lw-selection-split" role="status">
      <span>{words}</span>
      {held.length > 0 && <button type="button" className="primary" disabled={disabled} onClick={() => void play()}>Play the {held.length}</button>}
      {!choosing && <button type="button" disabled={disabled || !elsewhere.size} onClick={() => setChoosing(true)}>Choose another device</button>}
      {choosing && [...elsewhere].map(([device, theirs]) => (
        <button key={device} type="button" disabled={disabled} onClick={() => {
          const [first, ...others] = theirs;
          window.dispatchEvent(new CustomEvent<MoveOffer>(MOVE_NOW_EVENT, { detail: { songId: first.id, title: first.title ?? 'A song', device, speaker: holder.name, programme: others.map((song) => song.id) } }));
          setAsked(false); setChoosing(false);
        }}>Play {theirs.length} on {device}</button>
      ))}
    </span>
  );
}
