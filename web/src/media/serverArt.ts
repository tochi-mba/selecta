import { useSyncExternalStore } from 'react';
import { useFlag } from '../flags';

// Covers from the song's own file in the local app (ADR-0478, FL-0478-02, flag
// `library.art_embedded`). The local server reads the picture inside each file and serves it from
// this computer (`GET /api/songs/{id}/art`), so the page only needs to know where to ask. The local
// app binds that address once at its root; Cloud never does, so a Cloud page never asks for it and
// its covers stay on the device (artStore.ts). A song whose file has no picture answers with no
// content, and the cover ladder (views/CoverArt.tsx) keeps the generated tile.

type ArtAddress = (songId: number) => string;

let address: ArtAddress | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* one listener never stops the others */ }
  }
}

/** Where this computer serves a song's own cover. Returns a way to unbind. */
export function bindServerArt(next: ArtAddress | null): () => void {
  address = next;
  notify();
  return () => {
    if (address !== next) return;
    address = null;
    notify();
  };
}

/** The local server's address for a song's own cover, or null where none is bound. */
export function serverArtUrl(songId: number | null | undefined): string | null {
  if (!address || typeof songId !== 'number' || !Number.isInteger(songId) || songId < 1) return null;
  return address(songId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const bound = () => address;

/** The cover this computer serves for a song, while the flag is on and the local app has bound
 * an address; null otherwise. Null song ids (a cover that already has a picture) ask nothing. */
export function useServerArt(songId: number | null | undefined): string | null {
  const on = useFlag('library.art_embedded');
  useSyncExternalStore(subscribe, bound, bound);
  return on ? serverArtUrl(songId) : null;
}
