import { Ref, useEffect, useState } from 'react';
import { useFlag } from '../flags';
import { CoverArt } from './CoverArt';
import { useFeelOn } from './feelPieces';

/** A song a mix's face can be drawn from: its library id, and its content hash where it is known. */
export type FaceSong = { song_id: number; sha256?: string | null };

/** How many covers a mix's face shows. */
const FACE_COVERS = 4;
/** How many saved mixes, from the top of the list, have their songs read for a face. The rest keep
 * the generated tile, so a list of a hundred mixes never asks for a hundred recipes. */
export const FACES_READ = 12;

/** Faces already read this visit, by mix and revision: a changed mix is read again. */
const faces = new Map<string, Promise<FaceSong[]>>();

/** The first songs of the top saved mixes, for their faces. Only while `library.art_embedded` is on
 * (with it off there are no covers to show); a mix that can't be read keeps its generated tile. */
export function useMixFaces(list: readonly { mix_id: string; revision: string }[] | null, read: (mixId: string) => Promise<{ songs: readonly FaceSong[] }>): Map<string, FaceSong[]> {
  const art = useFlag('library.art_embedded');
  const [known, setKnown] = useState<Map<string, FaceSong[]>>(() => new Map());
  const wanted = art && list ? list.slice(0, FACES_READ).map((mix) => `${mix.mix_id}:${mix.revision}`).join('|') : '';
  useEffect(() => {
    if (!wanted || !list) return undefined;
    let live = true;
    for (const mix of list.slice(0, FACES_READ)) {
      const key = `${mix.mix_id}:${mix.revision}`;
      let found = faces.get(key);
      if (!found) {
        found = read(mix.mix_id).then((recipe) => recipe.songs.slice(0, FACE_COVERS).map(({ song_id, sha256 }) => ({ song_id, sha256 })));
        // a failed read is forgotten, so the next visit tries again
        found.catch(() => faces.delete(key));
        faces.set(key, found);
      }
      void found.then((songs) => {
        if (live) setKnown((before) => new Map(before).set(mix.mix_id, songs));
      }, () => undefined);
    }
    return () => { live = false; };
    // the list's identity changes on every load; what matters is which mixes, at which revisions
  }, [wanted]);
  return known;
}

/** A saved mix's own face (ADR-0477, ADR-0478): a collage of the covers of its first four songs,
 * so a long list of mixes stops looking like one mix repeated. Each quarter is a CoverArt, so a song
 * without a picture shows its generated tile, and with `library.art_embedded` off every quarter is
 * a generated tile too. A mix whose songs are not known yet shows the single generated tile it
 * always had.
 *
 * With every feel flag and `library.art_embedded` off this is exactly the tile it replaced: no
 * wrapper, no attributes. Otherwise the wrapper carries the pointer light (`data-glow`) and, when
 * `travels` is set, the shared name `mix-art`, so pressing Play or Edit can carry it to the next
 * page. Only one tile on a page may wear that name at once (a repeated name makes the browser give
 * up the transition), so the list gives it to the current mix's row alone. Decoration: hidden from
 * assistive technology, as the tile always was. */
export function MixArt({ seed, songs, travels = false, tileRef }: {
  seed: string;
  songs?: readonly FaceSong[] | null;
  travels?: boolean;
  tileRef?: Ref<HTMLSpanElement>;
}) {
  const art = useFlag('library.art_embedded');
  const feel = useFeelOn();
  if (!art && !feel) return <CoverArt seed={seed} />;
  const face = art && songs?.length ? songs.slice(0, FACE_COVERS) : null;
  return (
    <span ref={tileRef} className="mix-art" aria-hidden="true" data-glow="" data-collage={face && face.length > 1 ? face.length : undefined}
      data-vt={travels ? 'mix-art' : undefined}>
      {face
        ? face.map((song, index) => (
          <CoverArt key={`${song.song_id}-${index}`} seed={song.song_id} songId={song.song_id} songKey={song.sha256 ?? undefined} size="small" />
        ))
        : <CoverArt seed={seed} />}
    </span>
  );
}
