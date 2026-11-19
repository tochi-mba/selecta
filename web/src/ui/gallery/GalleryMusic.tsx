import { useState } from 'react';
import type { MixItem } from '../../api';
import {
  EnergyHorizon, EnergyOverview, EnergyThumb, FeelDiagram, LengthScale, MixHorizon, MixSignature, RouteDiagram, SeamDiagram, SongMotif, VibeMotif,
} from '../MusicObjects';

/** Invented songs for the specimens: no library, no server, no audio. */
const SONGS: MixItem[] = [
  { position: 0, song_id: 11, artist: 'Example artist', title: 'Opening song', duration: 214, bpm: 118, key: '8A', energy: 0.3, locked: false, seam: null },
  { position: 1, song_id: 23, artist: 'Example artist', title: 'A second song with a longer name', duration: 241, bpm: 122, key: '9A', energy: 0.55, locked: true,
    seam: { settings: { move: 'auto' }, state: { status: 'ready', key: 'gallery-1', style: 'blend', label: 'Blend' } } },
  { position: 2, song_id: 37, artist: 'Example artist', title: 'Peak', duration: 198, bpm: 124, key: '9B', energy: 0.85, locked: false,
    seam: { settings: { move: 'cut' }, state: { status: 'queued', key: 'gallery-2' } } },
  { position: 3, song_id: 41, artist: 'Example artist', title: 'Unmeasured song', duration: 230, bpm: null, key: null, energy: null, locked: false,
    seam: { settings: { move: 'auto' }, state: { status: 'failed', key: 'gallery-3', error: 'Example failure' } } },
  { position: 4, song_id: 52, artist: 'Example artist', title: 'Closing song', duration: 260, bpm: 112, key: '8A', energy: 0.4, locked: false,
    seam: { settings: { move: 'auto' }, state: { status: 'none', key: 'gallery-4' } } },
];

/** The drawn music objects (ui/MusicObjects.tsx), each fed invented data that says what it is. */
export function GalleryMusic() {
  const [selected, setSelected] = useState(1);
  return (
    <section className="stack gallery-music"><h3>Music objects</h3>
      <p className="hint">Invented songs. Each mark encodes only what its words say; the energy pictures leave unmeasured songs as gaps.</p>
      <div className="row wrap">
        <span className="row"><SongMotif songId={11} /><SongMotif songId={23} large /></span>
        <VibeMotif idea="late-night-warmup" group="Warm up" />
        <MixSignature items={SONGS} />
        <MixSignature items={SONGS} compact />
        <FeelDiagram feel="seamless" />
        <FeelDiagram feel="punchy" />
        <LengthScale songs={12} most={30} />
        <EnergyThumb values={SONGS.map((song) => song.energy)} />
      </div>
      <div className="stack">
        {SONGS.slice(1).map((song, index) => song.seam && (
          <SeamDiagram key={song.song_id} seam={song.seam} from={SONGS[index].title} into={song.title} compact={index === 3} />
        ))}
        <RouteDiagram songs={SONGS.slice(0, 3).map((song) => ({ id: song.song_id, title: song.title, artist: song.artist }))} requestedId={37} state="proposed" />
        <RouteDiagram songs={SONGS.slice(2).map((song) => ({ id: song.song_id, title: song.title }))} requestedId={52} state="ready" compact />
        <EnergyHorizon values={[0.2, 0.45, 0.7, 0.9, 0.5]} source="intention" />
        <EnergyHorizon values={[0.3, 0.55, 0.85, 0.4, 0.4]} source="measured" provisional />
        <MixHorizon items={SONGS} scope="current" />
        <EnergyOverview items={SONGS} selectedIndex={selected} onSelect={setSelected} playingIndex={0} />
      </div>
    </section>
  );
}
