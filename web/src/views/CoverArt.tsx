import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useFlag } from '../flags';
import { getArtHue, getArtUrl, peekArtUrl, songKeyFor, subscribeArt } from '../media/artStore';
import { useCatalogArt } from '../media/catalogArt';
import { useServerArt } from '../media/serverArt';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';
import { artHash } from '../feel/hue';

/** A cover tile drawn from a name or library id: a stable colour and angle, with the song's own
 * motif on it. It is decoration (the title is always beside it), so it is hidden from assistive
 * technology. Only the Cloud sheet (cloud/cloudMusic.css) draws it; elsewhere it takes no room.
 *
 * The ladder (ADR-0478 "Real or clearly generated"): a picture passed in (`artUrl`, for a
 * catalogue cover a later step serves from our own origin), else the song file's own picture
 * kept on this device (flag `library.art_embedded`), else the generated tile alone. The tile is
 * always drawn underneath, so a picture that is slow, missing or broken leaves exactly today's
 * tile. Pictures are only ever local `blob:` URLs or our own origin's, never a third party's. */
export function CoverArt({ seed, songId, size = 'row', songKey, artUrl, artHue }: {
  seed: string | number;
  songId?: number;
  size?: 'hero' | 'row' | 'small';
  /** The song's content hash, where the caller has it; otherwise `songId` is looked up. */
  songKey?: string;
  /** A picture from our own origin (the catalogue), shown in place of the file's own. */
  artUrl?: string;
  /** That picture's palette hue, 0 to 359, or null. */
  artHue?: number | null;
}) {
  // the same hash the ambient hue uses (feel/hue.ts), so the room is tinted in the tile's hue
  const hash = artHash(seed);
  const hero = size === 'hero';
  const own = useSongArt(artUrl ? null : songKey ?? songId ?? null, { large: hero });
  // the rungs below the device's own copy, each asked only while everything above has no picture:
  // the local app's server reading the file (FL-0478-02), then Cloud's catalogue (FL-0478-04)
  const ownAny = own.small ?? own.large;
  const served = useServerArt(artUrl || ownAny ? null : songId);
  const catalog = useCatalogArt(artUrl || ownAny || served ? null : songId);
  const full = artUrl ?? (hero ? own.large : own.small) ?? served ?? catalog?.url ?? null;
  // blur-up: on the hero, the small picture stretched (soft by nature) shows while the large decodes
  const preview = !artUrl && hero ? own.small : null;
  const palette = artUrl ? artHue ?? null : catalog && full === catalog.url ? catalog.hue : own.hue;
  const style = {
    '--art-hue': String(hash % 360),
    '--art-turn': `${100 + ((hash >>> 9) % 160)}deg`,
    ...(full && palette !== null ? { '--art-palette-hue': String(palette) } : {}),
  } as CSSProperties;
  return (
    <span className="cover-art" data-size={size} style={style} aria-hidden="true" {...(full ? { 'data-art': '' } : {})}>
      {songId !== undefined ? <SongMotif songId={songId} /> : <Icon name="music" />}
      {preview && preview !== full ? <ArtLayer src={preview} layer="preview" /> : null}
      {full ? <ArtLayer key={full} src={full} layer="full" /> : null}
    </span>
  );
}

/** One picture over the tile: decoded off-screen first, then faded in (`--motion-reveal`). A
 * picture that will not decode is simply not shown, leaving the tile. */
function ArtLayer({ src, layer }: { src: string; layer: 'preview' | 'full' }) {
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>('loading');
  useEffect(() => {
    let live = true;
    setState('loading');
    const probe = new Image();
    probe.decoding = 'async';
    probe.src = src;
    const settle = (next: 'ready' | 'broken') => { if (live) setState(next); };
    if (typeof probe.decode === 'function') probe.decode().then(() => settle('ready'), () => settle('broken'));
    else {
      probe.onload = () => settle('ready');
      probe.onerror = () => settle('broken');
    }
    return () => { live = false; };
  }, [src]);
  if (state === 'broken') return null;
  // alt is empty: the song's title is always written beside its cover
  return <img className="cover-art-image" data-layer={layer} data-ready={state === 'ready' ? '' : undefined} src={src} alt="" loading="lazy" decoding="async" draggable={false} />;
}

export type SongArt = { small: string | null; large: string | null; hue: number | null };
const NO_ART: SongArt = { small: null, large: null, hue: null };

/** A song's own cover from this device, for any component: `song` is its content hash, or its
 * song id in the open workspace. Empty while the flag is off, while loading and where the file
 * had no picture. The large size is fetched only when asked for.
 *
 *   const { large, hue } = useSongArt(item.song_id, { large: true });
 *   const tint = hue ?? fallbackHue; // e.g. tint the room from the playing song's own cover
 */
export function useSongArt(song: string | number | null | undefined, options: { large?: boolean } = {}): SongArt {
  const on = useFlag('library.art_embedded');
  const wantLarge = options.large === true;
  // the art is held with the song it belongs to, so a reused tile never shows the last song's
  const [held, setHeld] = useState<{ song: string | number; art: SongArt } | null>(null);
  const [revision, setRevision] = useState(0);
  const resolved = useRef<string | null>(null);
  const active = on && song !== null && song !== undefined && song !== '';
  useEffect(() => {
    if (!active) return undefined;
    // only this song's change (or a change to every song) re-reads, so an import storing
    // hundreds of covers does not re-read every tile on the page
    return subscribeArt((changed) => {
      if (changed === null || resolved.current === null || changed === resolved.current) setRevision((value) => value + 1);
    });
  }, [active]);
  useEffect(() => {
    if (!active || song === null || song === undefined) return undefined;
    let live = true;
    const keep = (art: SongArt) => { if (live) setHeld({ song, art }); };
    void (async () => {
      const sha = typeof song === 'number' ? await songKeyFor(song) : song;
      if (live) resolved.current = sha ?? null;
      if (!sha) { keep(NO_ART); return; }
      const [small, large, hue] = await Promise.all([
        getArtUrl(sha, 'small'),
        wantLarge ? getArtUrl(sha, 'large') : Promise.resolve(null),
        getArtHue(sha),
      ]);
      keep(small || large ? { small, large, hue } : NO_ART);
    })().catch(() => keep(NO_ART));
    return () => { live = false; };
  }, [active, song, wantLarge, revision]);
  if (!active) return NO_ART;
  if (held?.song === song) return held.art;
  // a first render can still show a picture this page already made, without a flash of the tile
  if (typeof song === 'string') {
    const small = peekArtUrl(song, 'small');
    if (small) return { small, large: wantLarge ? peekArtUrl(song, 'large') : null, hue: null };
  }
  return NO_ART;
}
