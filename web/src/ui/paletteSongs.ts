import { useEffect, useMemo, useRef, useState } from 'react';
import { get, LibraryPage, LibrarySong } from '../api';
import { navigate } from '../router';
import type { Command } from '../shell/commands';
import { trackReadiness } from '../state/readiness';

const WAIT_MS = 150;
const MOST = 8;

/** Songs for the command palette, looked up as someone types. Only the answer to exactly what's in
 * the box now is ever shown, so a slow answer to something typed earlier can't appear or be chosen.
 * Choosing a song only opens its details in the Library: it never plays, adds or changes anything. */
export function usePaletteSongs(text: string): { commands: Command[]; failed: boolean } {
  const [found, setFound] = useState<{ query: string; songs: LibrarySong[] } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    const mine = ++asked.current;
    if (text.length < 2) return;
    const wait = window.setTimeout(() => {
      get<LibraryPage>(`/library?q=${encodeURIComponent(text)}&limit=${MOST}&state=all`)
        .then((page) => {
          if (mine !== asked.current) return;
          setFound({ query: text, songs: Array.isArray(page?.songs) ? page.songs.slice(0, MOST) : [] });
          setFailedFor(null);
        })
        .catch(() => {
          if (mine !== asked.current) return;
          setFound(null);
          setFailedFor(text);
        });
    }, WAIT_MS);
    return () => {
      // anything still on its way was for something no longer in the box
      asked.current += 1;
      window.clearTimeout(wait);
    };
  }, [text]);

  const commands = useMemo<Command[]>(() => {
    if (text.length < 2 || !found || found.query !== text) return [];
    const titles = new Map<string, number>();
    for (const song of found.songs) {
      const title = (song.title ?? 'Untitled').toLocaleLowerCase();
      titles.set(title, (titles.get(title) ?? 0) + 1);
    }
    return found.songs.map((song): Command => {
      const title = song.title ?? 'Untitled';
      const shared = (titles.get(title.toLocaleLowerCase()) ?? 0) > 1;
      return {
        id: `song-${song.id}`,
        label: `${title} — ${song.artist ?? 'Unknown artist'}${shared ? ` (song ${song.id})` : ''}`,
        group: 'Songs',
        // what the Library says about it, so a found song is never taken for one that's ready
        detail: `${trackReadiness(song).words}, opens its details`,
        run: () => navigate(`/library?q=${encodeURIComponent(song.title ?? String(song.id))}&song=${song.id}`),
      };
    });
  }, [found, text]);

  return { commands, failed: text.length >= 2 && failedFor === text };
}
