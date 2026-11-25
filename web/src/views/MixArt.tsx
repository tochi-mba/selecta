import { MutableRefObject, Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFlag } from '../flags';
import { hasArt, songKeyFor, subscribeArt } from '../media/artStore';
import { useCatalogArt } from '../media/catalogArt';
import { serverArtUrl } from '../media/serverArt';
import { CoverArt } from './CoverArt';
import { useFeelOn } from './feelPieces';

/** A song a mix's face can be drawn from: its library id, and its content hash where it is known. */
export type FaceSong = { song_id: number; sha256?: string | null };
/** A song with a real cover of its own: on this device (with its content hash) or served by this
 * computer's local app. */
type RealCover = { song_id: number; sha256?: string };

/** How many covers a mix's face shows. */
const FACE_COVERS = 4;
/** How many of a mix's first songs are looked at for real covers, so a mix whose opening songs have
 * no pictures can still be drawn from the next few. */
const FACE_CANDIDATES = 8;
/** Fewer real covers than this and a collage would be mostly generated tiles, which tells two mixes
 * apart no better than the single generated tile: that tile is shown instead. */
const MIN_REAL = 2;
/** Saved mixes read at once for their songs, so scrolling a long list never floods the network. */
const READS_AT_ONCE = 2;

// ---------- near the screen: one observer for every face on the page ----------

// A list of many mixes reads nothing for a face until it is near the screen. One shared observer
// watches every face (not one per row), and forgets each as soon as it has been seen once.
let nearObserver: IntersectionObserver | null = null;
const nearWaiting = new Map<Element, () => void>();

/** Calls `then` once, when `element` first comes within half a screen of being seen. At once where
 * the browser cannot tell. Returns a way to stop waiting. */
export function whenNear(element: Element, then: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    then();
    return () => undefined;
  }
  if (!nearObserver) {
    nearObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const run = nearWaiting.get(entry.target);
        nearWaiting.delete(entry.target);
        nearObserver?.unobserve(entry.target);
        run?.();
      }
    }, { rootMargin: '50% 0px' });
  }
  nearWaiting.set(element, then);
  nearObserver.observe(element);
  return () => {
    if (nearWaiting.delete(element)) nearObserver?.unobserve(element);
  };
}

// ---------- which of a mix's songs have a real cover ----------

const realKnown = new Map<string, RealCover[]>();
const realReading = new Map<string, Promise<RealCover[]>>();
let watchingArt = false;

/** The songs a face is drawn from, as one string, so the same songs are only looked at once. */
export function faceKey(songs: readonly FaceSong[]): string {
  return songs.slice(0, FACE_CANDIDATES).map((song) => `${song.song_id}:${song.sha256 ?? ''}`).join('|');
}

/** Whether a picture really decodes: the local app serves an empty answer for a file without one. */
function decodes(src: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  const probe = new Image();
  probe.decoding = 'async';
  probe.src = src;
  if (typeof probe.decode === 'function') return probe.decode().then(() => true, () => false);
  return new Promise((resolve) => {
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
  });
}

/** The songs among the mix's opening ones whose file has its own picture, in mix order: kept on
 * this device (Cloud), or served by this computer (the local app). The catalogue's covers are
 * heard separately (CatalogProbe), because they belong to the page's account. */
function readRealCovers(songs: readonly FaceSong[], key: string): Promise<RealCover[]> {
  if (!watchingArt) {
    // A cover added or removed anywhere makes every answer here stale. One subscription for the
    // whole page; a face already drawn keeps its covers until it is drawn again.
    watchingArt = true;
    subscribeArt(() => {
      realKnown.clear();
      realReading.clear();
    });
  }
  let found = realReading.get(key);
  if (!found) {
    const candidates = songs.slice(0, FACE_CANDIDATES);
    found = Promise.all(candidates.map(async (song) => {
      const sha = song.sha256 || await songKeyFor(song.song_id);
      if (sha && await hasArt(sha)) return { song_id: song.song_id, sha256: sha };
      const served = serverArtUrl(song.song_id);
      return served && await decodes(served) ? { song_id: song.song_id } : null;
    })).then((covers) => {
      const real = covers.filter((cover): cover is RealCover => cover !== null);
      realKnown.set(key, real);
      return real;
    }, () => {
      // a failed read is forgotten, so the face is looked at again next time
      realReading.delete(key);
      return [] as RealCover[];
    });
    realReading.set(key, found);
  }
  return found;
}

// ---------- the songs of saved mixes, read as their rows come near ----------

/** Faces already read this visit, by mix and revision: a changed mix is read again. */
const faces = new Map<string, Promise<FaceSong[]>>();
let reading = 0;
const waitingReads: (() => void)[] = [];

/** Runs `work` when fewer than READS_AT_ONCE are running. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      reading += 1;
      work().then(resolve, reject).finally(() => {
        reading -= 1;
        waitingReads.shift()?.();
      });
    };
    if (reading < READS_AT_ONCE) run();
    else waitingReads.push(run);
  });
}

function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

type Known = { revision: string; songs: FaceSong[] };

/** The first songs of saved mixes, for their faces, read only when a row asks (MixArt's `want`,
 * called when its face comes near the screen). Only while `library.art_embedded` is on (with it off
 * there are no covers to show); a mix that can't be read keeps its generated tile. Answers that
 * arrive together redraw the list once. */
export function useMixFaces(list: readonly { mix_id: string; revision: string }[] | null, read: (mixId: string) => Promise<{ songs: readonly FaceSong[] }>): {
  faces: Map<string, FaceSong[]>;
  want: (mixId: string) => void;
} {
  const art = useFlag('library.art_embedded');
  const [known, setKnown] = useState<Map<string, Known>>(() => new Map());
  const latest = useRef({ list, read });
  latest.current = { list, read };
  const asked = useRef(new Set<string>());
  const arrived = useRef(new Map<string, Known>());
  const flushing = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const want = useCallback((mixId: string) => {
    if (!art) return;
    const mix = latest.current.list?.find((item) => item.mix_id === mixId);
    if (!mix) return;
    const key = `${mix.mix_id}:${mix.revision}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    let found = faces.get(key);
    if (!found) {
      found = inTurn(() => latest.current.read(mixId))
        .then((recipe) => recipe.songs.slice(0, FACE_CANDIDATES).map(({ song_id, sha256 }) => ({ song_id, sha256 })));
      // a failed read is forgotten, so the next visit tries again
      found.catch(() => faces.delete(key));
      faces.set(key, found);
    }
    found.then((songs) => {
      if (!live.current) return;
      arrived.current.set(mixId, { revision: mix.revision, songs });
      if (flushing.current) return;
      flushing.current = true;
      nextFrame(() => {
        flushing.current = false;
        if (!live.current) return;
        const batch = arrived.current;
        arrived.current = new Map();
        setKnown((before) => {
          const next = new Map(before);
          for (const [id, face] of batch) next.set(id, face);
          return next;
        });
      });
    }, () => { asked.current.delete(key); });
  }, [art]);

  // a mix changed since its face was read (a new revision) is read again; its old face shows until
  // the new one arrives, so the row never blinks back to the generated tile
  const revisions = list?.map((mix) => `${mix.mix_id}:${mix.revision}`).join('|') ?? '';
  useEffect(() => {
    for (const mix of latest.current.list ?? []) {
      const had = known.get(mix.mix_id);
      if (had && had.revision !== mix.revision) want(mix.mix_id);
    }
  }, [revisions, known, want]);

  const shown = useMemo(() => {
    const out = new Map<string, FaceSong[]>();
    if (!art) return out;
    for (const [id, face] of known) out.set(id, face.songs);
    return out;
  }, [known, art]);
  return { faces: shown, want };
}

// ---------- the face ----------

/** Hears whether the catalogue has a confident cover for one song (flag `library.art_lookup`), the
 * ladder's last rung before the generated tile. Draws nothing. */
function CatalogProbe({ songId, onAnswer }: { songId: number; onAnswer: (songId: number, real: boolean) => void }) {
  const real = !!useCatalogArt(songId);
  useEffect(() => { onAnswer(songId, real); }, [songId, real, onAnswer]);
  return null;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

/** A mix's own face (ADR-0477, ADR-0478): a collage of the real covers of its first songs, so a long
 * list of mixes stops looking like one mix repeated. Only real pictures go in, from CoverArt's
 * ladder (the song file's own, on this device or served by the local app, then the catalogue's); a
 * mix with fewer than two shows the single generated tile it always had, as does a mix whose songs
 * are not known yet. Two covers sit side by side, three put the
 * first one tall, four make a two by two square.
 *
 * Nothing is read until the face is near the screen, so a long list draws at once and fills in as
 * it scrolls. `want` asks the list for the mix's songs when they are not known.
 *
 * With every feel flag and `library.art_embedded` off this is exactly the tile it replaced: no
 * wrapper, no attributes. Otherwise the wrapper carries the pointer light (`data-glow`) and, when
 * `travels` is set, the shared name `mix-art`, so pressing Play or Edit can carry it to the next
 * page. Only one tile on a page may wear that name at once (a repeated name makes the browser give
 * up the transition), so a list gives it to the current mix's row alone. Decoration: hidden from
 * assistive technology, as the tile always was. */
export function MixArt({ seed, songs, travels = false, tileRef, want }: {
  seed: string;
  songs?: readonly FaceSong[] | null;
  travels?: boolean;
  tileRef?: Ref<HTMLSpanElement>;
  /** Asks for this mix's songs; called once the face is near the screen and its songs are unknown. */
  want?: () => void;
}) {
  const art = useFlag('library.art_embedded');
  const lookup = useFlag('library.art_lookup');
  const feel = useFeelOn();
  const shown = art || feel;
  const box = useRef<HTMLSpanElement | null>(null);
  const [catalog, setCatalog] = useState<ReadonlySet<number>>(() => new Set());
  const heard = useCallback((songId: number, real: boolean) => {
    setCatalog((before) => {
      if (before.has(songId) === real) return before;
      const next = new Set(before);
      if (real) next.add(songId);
      else next.delete(songId);
      return next;
    });
  }, []);
  const key = art && songs?.length ? faceKey(songs) : '';
  const [read, setRead] = useState<{ key: string; covers: RealCover[] } | null>(null);
  const [near, setNear] = useState(false);
  const known = key ? realKnown.get(key) ?? (read?.key === key ? read.covers : null) : null;
  const needsSongs = shown && art && !songs && !!want;
  // the catalogue is only heard from near the screen too, even when the file covers are known
  const needsCovers = !!key && (!known || lookup);

  useEffect(() => {
    const element = box.current;
    if (near || !element || !(needsSongs || needsCovers)) return undefined;
    return whenNear(element, () => setNear(true));
  }, [near, needsSongs, needsCovers]);

  const asking = useRef(want);
  asking.current = want;
  useEffect(() => {
    if (near && needsSongs) asking.current?.();
  }, [near, needsSongs]);

  const latestSongs = useRef(songs);
  latestSongs.current = songs;
  useEffect(() => {
    const list = latestSongs.current;
    if (!near || !key || !list?.length) return undefined;
    let live = true;
    void readRealCovers(list, key).then((covers) => { if (live) setRead({ key, covers }); });
    return () => { live = false; };
  }, [near, key]);

  const setBox = useCallback((element: HTMLSpanElement | null) => {
    box.current = element;
    assign(tileRef, element);
  }, [tileRef]);

  if (!shown) return <CoverArt seed={seed} />;
  // the face's covers, in mix order: the file's own first, then the catalogue's, at most four
  const candidates = key && songs ? songs.slice(0, FACE_CANDIDATES) : [];
  const own = new Map((known ?? []).map((cover) => [cover.song_id, cover] as const));
  const real = candidates.flatMap((song): RealCover[] => {
    const mine = own.get(song.song_id);
    if (mine) return [mine];
    return catalog.has(song.song_id) ? [{ song_id: song.song_id }] : [];
  }).slice(0, FACE_COVERS);
  const face = known && real.length >= MIN_REAL ? real : null;
  return (
    <span ref={setBox} className="mix-art" aria-hidden="true" data-glow="" data-collage={face ? face.length : undefined}
      data-vt={travels ? 'mix-art' : undefined}>
      {face
        ? face.map((song, index) => (
          <CoverArt key={`${song.song_id}-${index}`} seed={song.song_id} songId={song.song_id} songKey={song.sha256} size="small" />
        ))
        : <CoverArt seed={seed} />}
      {near && lookup && candidates.map((song, index) => (
        <CatalogProbe key={`${song.song_id}-${index}`} songId={song.song_id} onAnswer={heard} />
      ))}
    </span>
  );
}
