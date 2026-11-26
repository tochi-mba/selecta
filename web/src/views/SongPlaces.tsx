import { useContext } from 'react';
import type { LibrarySong } from '../api';
import { HolderContext, type MusicHolder } from '../devices/controller';
import { Action } from '../ui/controls';
import { relativeTime } from '../ui/format';
import { LibraryPlacesContext, RemoveFromCloud, sizeWords, type LibraryPlacesChrome } from './LibraryPlaces';

// ADR-0475 I90: a song's details on a device that is one of several say where its file lives
// (this device, each open device, each closed one and when it was last open), list its versions
// when there are several, and offer what makes sense from here: play it next on the speaker.
// What needs the file itself is not offered here; the line says which device can do it.
// library.places: with a cloud library, this device and the cloud library each have their row too.

type Row = { name: string; words: string };

export function SongPlaces({ song, onPlayNext, onChanged, notify }: {
  song: LibrarySong;
  /** Put the song next on the speaker; given only while another device plays. */
  onPlayNext?: (song: LibrarySong) => Promise<unknown>;
  /** library.places: the song's places changed (it left the cloud library) */
  onChanged?: () => void;
  notify?: (message: string) => void;
}) {
  const holder = useContext(HolderContext);
  const chrome = useContext(LibraryPlacesContext);
  if (chrome && song.places) return <KeptPlaces song={song} chrome={chrome} holder={holder} onPlayNext={onPlayNext} onChanged={onChanged} notify={notify} />;
  if (!holder) return null;
  const places = holder.places?.(song.id) ?? { online: [], before: [] };
  const here = song.availability === 'here' || song.availability === 'reauth' || song.availability === 'reconnect';
  const rows: Row[] = [
    ...(here ? [{ name: 'This device', words: song.availability === 'here' ? 'Plays here' : 'Needs its folder chosen again here' }] : []),
    ...otherRows(holder, places),
  ];
  const fileDevice = here ? null : places.online[0] ?? places.before[0] ?? null;
  return (
    <section className="stack song-places" aria-label="Where it lives">
      <h3>Where it lives</h3>
      {rows.length
        ? <dl className="song-facts song-facts-table">{rows.map((row) => <div key={row.name}><dt>{row.name}</dt><dd>{row.words}</dd></div>)}</dl>
        : <p className="hint">None of your devices has this song’s file right now.</p>}
      <Versions song={song} />
      {fileDevice && <p className="hint">Changes that need the file itself are made on {fileDevice}.</p>}
      <PlayNext song={song} holder={holder} places={places} onPlayNext={onPlayNext} />
    </section>
  );
}

function otherRows(holder: MusicHolder, places: { online: readonly string[]; before: readonly string[] }): Row[] {
  return [
    ...places.online.map((name) => ({ name, words: name === holder.name && holder.speaking ? 'Open now, playing the music' : 'Open now' })),
    ...places.before.map((name) => {
      const age = holder.lastOpen?.(name);
      return { name, words: age == null ? 'Not open now' : `Last open ${relativeTime(age)}` };
    }),
  ];
}

function Versions({ song }: { song: LibrarySong }) {
  const versions = song.versions ?? [];
  if (versions.length < 2) return null;
  return (
    <>
      <h3>Versions</h3>
      <ul className="song-versions">
        {versions.map((version) => (
          <li key={version.id}>{version.format?.toUpperCase() ?? 'File'}, {Math.floor(version.length / 60)}:{String(Math.round(version.length % 60)).padStart(2, '0')}{version.here ? ', on this device' : ''}{version.primary ? ' (the one mixes use)' : ''}</li>
        ))}
      </ul>
    </>
  );
}

function PlayNext({ song, holder, places, onPlayNext }: {
  song: LibrarySong;
  holder: MusicHolder | null;
  places: { online: readonly string[] };
  onPlayNext?: (song: LibrarySong) => Promise<unknown>;
}) {
  if (!holder || !onPlayNext) return null;
  const speakerHas = !holder.ids || holder.ids.has(song.id);
  const movesTo = places.online.find((name) => name !== holder.name) ?? null;
  if (speakerHas) return <div className="row wrap"><Action run={() => onPlayNext(song)} aria-label={`Play ${song.title ?? 'this song'} next on ${holder.name}`}>Play next on {holder.name}</Action></div>;
  // I85: on another open device only, the press asks whether to move the music there
  if (movesTo) return <div className="row wrap"><Action run={() => onPlayNext(song)} aria-label={`Play ${song.title ?? 'this song'} on ${movesTo}`}>Play on {movesTo}</Action></div>;
  return null;
}

const DEVICE_WORDS = { here: 'Plays here', reauth: 'Allow again to play here', reconnect: 'Choose again to play here' } as const;

/** library.places: this device, the cloud library and each other device, each on its own row. */
function KeptPlaces({ song, chrome, holder, onPlayNext, onChanged, notify }: {
  song: LibrarySong;
  chrome: LibraryPlacesChrome;
  holder: MusicHolder | null;
  onPlayNext?: (song: LibrarySong) => Promise<unknown>;
  onChanged?: () => void;
  notify?: (message: string) => void;
}) {
  const places = song.places!;
  const cloud = places.cloud;
  const others = holder ? otherRows(holder, places.other) : [];
  // the server counts a device holding it that this one cannot name yet
  const unnamed = !others.length && places.other.devices > (places.device ? 1 : 0);
  const cloudWords = !cloud ? 'Not in your cloud library'
    : [
      `${sizeWords(cloud.bytes)}${cloud.format ? `, ${cloud.format.toUpperCase()}` : ''}`,
      cloud.copies > 1 ? `${cloud.copies} copies kept` : null,
      cloud.measuring ? 'Getting ready' : chrome.offline ? 'Needs a connection' : 'Plays on all your devices',
    ].filter(Boolean).join('. ');
  const rows: Row[] = [
    { name: 'This device', words: places.device ? DEVICE_WORDS[places.device] : 'Not on this device' },
    { name: 'Your cloud library', words: cloudWords },
    ...others,
    ...(unnamed ? [{ name: 'Another device', words: 'Has this song’s file' }] : []),
  ];
  return (
    <section className="stack song-places" aria-label="Where it is kept" data-places="">
      <h3>Where it is kept</h3>
      <dl className="song-facts song-facts-table">{rows.map((row) => <div key={row.name}><dt>{row.name}</dt><dd>{row.words}</dd></div>)}</dl>
      <Versions song={song} />
      {cloud && (
        <div className="row wrap">
          <RemoveFromCloud songs={[song]} chrome={chrome} onDone={(_answer, words) => { notify?.(words); onChanged?.(); }} />
        </div>
      )}
      {/* Phase 6 (cloud.move_to_cloud): uploading this song from this device goes here */}
      {chrome.uploadActions?.(song)}
      <PlayNext song={song} holder={holder} places={places.other} onPlayNext={onPlayNext} />
    </section>
  );
}
