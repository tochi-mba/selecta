import { useContext } from 'react';
import type { LibrarySong } from '../api';
import { HolderContext } from '../devices/controller';
import { Action } from '../ui/controls';
import { relativeTime } from '../ui/format';

// ADR-0475 I90: a song's details on a device that is one of several say where its file lives
// (this device, each open device, each closed one and when it was last open), list its versions
// when there are several, and offer what makes sense from here: play it next on the speaker.
// What needs the file itself is not offered here; the line says which device can do it.

export function SongPlaces({ song, onPlayNext }: {
  song: LibrarySong;
  /** Put the song next on the speaker; given only while another device plays. */
  onPlayNext?: (song: LibrarySong) => Promise<unknown>;
}) {
  const holder = useContext(HolderContext);
  if (!holder) return null;
  const places = holder.places?.(song.id) ?? { online: [], before: [] };
  const here = song.availability === 'here' || song.availability === 'reauth' || song.availability === 'reconnect';
  const rows: Array<{ name: string; words: string }> = [
    ...(here ? [{ name: 'This device', words: song.availability === 'here' ? 'Plays here' : 'Needs its folder chosen again here' }] : []),
    ...places.online.map((name) => ({ name, words: name === holder.name && holder.speaking ? 'Open now, playing the music' : 'Open now' })),
    ...places.before.map((name) => {
      const age = holder.lastOpen?.(name);
      return { name, words: age == null ? 'Not open now' : `Last open ${relativeTime(age)}` };
    }),
  ];
  const fileDevice = here ? null : places.online[0] ?? places.before[0] ?? null;
  const versions = song.versions ?? [];
  const speakerHas = !holder.ids || holder.ids.has(song.id);
  const movesTo = places.online.find((name) => name !== holder.name) ?? null;
  return (
    <section className="stack song-places" aria-label="Where it lives">
      <h3>Where it lives</h3>
      {rows.length
        ? <dl className="song-facts song-facts-table">{rows.map((row) => <div key={row.name}><dt>{row.name}</dt><dd>{row.words}</dd></div>)}</dl>
        : <p className="hint">None of your devices has this song’s file right now.</p>}
      {versions.length > 1 && (
        <>
          <h3>Versions</h3>
          <ul className="song-versions">
            {versions.map((version) => (
              <li key={version.id}>{version.format?.toUpperCase() ?? 'File'}, {Math.floor(version.length / 60)}:{String(Math.round(version.length % 60)).padStart(2, '0')}{version.here ? ', on this device' : ''}{version.primary ? ' (the one mixes use)' : ''}</li>
            ))}
          </ul>
        </>
      )}
      {fileDevice && <p className="hint">Changes that need the file itself are made on {fileDevice}.</p>}
      {onPlayNext && speakerHas && <div className="row wrap"><Action run={() => onPlayNext(song)} aria-label={`Play ${song.title ?? 'this song'} next on ${holder.name}`}>Play next on {holder.name}</Action></div>}
      {/* I85: on another open device only, the press asks whether to move the music there */}
      {onPlayNext && !speakerHas && movesTo && <div className="row wrap"><Action run={() => onPlayNext(song)} aria-label={`Play ${song.title ?? 'this song'} on ${movesTo}`}>Play on {movesTo}</Action></div>}
    </section>
  );
}
