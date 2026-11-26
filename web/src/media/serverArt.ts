import { useEffect, useSyncExternalStore } from 'react';
import { fetchBytes } from '../api';
import { useFlag } from '../flags';
import { artSupported, makeArt, type ArtSize } from './artWorker';

// Covers from the song's own file in the local app (ADR-0478, FL-0478-02, flag
// `library.art_embedded`). The local server reads the picture inside each file and serves it from
// this computer (`GET /api/songs/{id}/art`), so the page only needs to know where to ask. The local
// app binds that address once at its root; Cloud never does, so a Cloud page never asks for it and
// its covers stay on the device (artStore.ts). A song whose file has no picture answers with no
// content, and the cover ladder (views/CoverArt.tsx) keeps the generated tile.
//
// Drawn at display size (T-20261125-4054). The server keeps the file's picture as stored (Pillow
// is not a dependency) and refuses giant and moving ones by their header. The page then fetches the
// picture once, checks its header again, and redraws its first frame at the two cover sizes Cloud
// uses (artWorker.ts `makeArt`), so a 6000 px picture is never laid into every Library row and a
// picture can never move. The redrawn copies are `blob:` URLs kept for an hour, the server's own
// cache time, so a file given a new cover shows it. Where the browser cannot redraw off-screen the
// served address is used as before, still guarded by the server's checks.

type ArtAddress = (songId: number) => string;

let address: ArtAddress | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
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

const snapshot = () => version;

// ---------- redrawn at display size ----------

/** A redrawn picture is asked for again after this long: the server's own cache time. */
const KEEP_MS = 60 * 60 * 1000;
/** A fetch that failed (the app restarting, say) is tried again after this long, not at once. */
const RETRY_MS = 60 * 1000;
/** Pictures redrawn at once: a page of rows must not queue fifty decodes on the page together. */
const AT_ONCE = 2;
/** Redrawn covers kept at most; the oldest are let go past this (each is a few kilobytes). */
const MAX_KEPT = 600;

type Redrawn = { small: string | null; large: string | null; until: number };

const redrawn = new Map<string, Redrawn>();
const pending = new Set<string>();
const line: string[] = [];
let running = 0;

function letGo(entry: Redrawn | undefined): void {
  if (!entry) return;
  for (const url of [entry.small, entry.large]) if (url) URL.revokeObjectURL(url);
}

function keep(src: string, entry: Redrawn): void {
  letGo(redrawn.get(src));
  redrawn.delete(src);
  redrawn.set(src, entry);
  while (redrawn.size > MAX_KEPT) {
    const oldest = redrawn.keys().next().value as string;
    letGo(redrawn.get(oldest));
    redrawn.delete(oldest);
  }
  notify();
}

async function redraw(src: string): Promise<Redrawn> {
  const now = Date.now();
  try {
    // the local server's own address, through the one byte reader every local page uses
    const response = await fetchBytes(src.replace(/^\/api(?=\/)/, ''));
    // 204: the file has no usable picture, so the tile is right for the server's cache time
    if (response.status !== 200) return { small: null, large: null, until: now + (response.status === 204 || response.status === 404 ? KEEP_MS : RETRY_MS) };
    const bytes = new Uint8Array(await response.arrayBuffer());
    // makeArt reads the header first and refuses a giant picture before any decode
    const art = await makeArt(bytes, response.headers.get('content-type') ?? '');
    if (!art) return { small: null, large: null, until: now + KEEP_MS };
    return { small: URL.createObjectURL(art.small), large: URL.createObjectURL(art.large), until: now + KEEP_MS };
  } catch {
    return { small: null, large: null, until: now + RETRY_MS };
  }
}

function pump(): void {
  while (running < AT_ONCE && line.length) {
    const src = line.shift() as string;
    running += 1;
    void redraw(src).then((entry) => {
      running -= 1;
      pending.delete(src);
      keep(src, entry);
      pump();
    });
  }
}

function ask(src: string): void {
  if (pending.has(src)) return;
  const entry = redrawn.get(src);
  if (entry && entry.until > Date.now()) return;
  pending.add(src);
  line.push(src);
  pump();
}

/** The redrawn copy of `src` at `size`: undefined while not yet redrawn, null for no picture. */
function redrawnFor(src: string, size: ArtSize): string | null | undefined {
  const entry = redrawn.get(src);
  return entry ? entry[size] : undefined;
}

/** For tests: forget every redrawn copy. */
export function resetServerArtForTests(): void {
  for (const entry of redrawn.values()) letGo(entry);
  redrawn.clear();
  pending.clear();
  line.length = 0;
  running = 0;
}

/** The cover this computer serves for a song, while the flag is on and the local app has bound
 * an address; null otherwise. Null song ids (a cover that already has a picture) ask nothing.
 * `size` picks the redrawn copy: `small` (96 px) for rows, `large` (512 px) for the hero. While a
 * copy is being made the answer is null, so the generated tile shows rather than the full picture;
 * an old copy keeps showing while a fresh one is made. */
export function useServerArt(songId: number | null | undefined, size: ArtSize = 'small'): string | null {
  const on = useFlag('library.art_embedded');
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const src = on ? serverArtUrl(songId) : null;
  const canRedraw = typeof fetch === 'function' && artSupported() && typeof URL.createObjectURL === 'function';
  const entry = src ? redrawn.get(src) : undefined;
  const stale = !entry || entry.until <= Date.now();
  useEffect(() => {
    if (src && canRedraw && stale) ask(src);
  }, [src, canRedraw, stale]);
  if (!src) return null;
  if (!canRedraw) return src;
  return redrawnFor(src, size) ?? null;
}
