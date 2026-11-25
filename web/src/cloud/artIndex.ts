import { useEffect } from 'react';
import { bindArtIndex } from '../media/artStore';
import type { MediaStore } from '../media';

/** ADR-0478: covers are stored by a file's content hash, but pages know songs by id. The open
 * workspace's own song index turns one into the other, so a cover is only ever shown for a song
 * this account really holds. A song whose file has changed has no cover until it is imported
 * again. Kept out of LocalFirstShell.tsx, which is at the file-length cap. */
export function useArtIndex(openStore: () => Promise<MediaStore>) {
  useEffect(() => bindArtIndex(async (id) => {
    const song = await (await openStore()).get(id);
    return song && song.availabilityIssue !== 'changed' ? song.identity.content_sha256 : null;
  }), [openStore]);
}
