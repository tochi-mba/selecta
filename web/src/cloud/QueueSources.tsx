import { useEffect, useState } from 'react';
import type { MixItem } from '../api';
import type { SourceBook, SourceEntry } from '../media';
import { PageLink } from '../shell/PageLink';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';

/** Where each queued song plays from (ADR-0465, BF-0465-03): this device, the hosted library,
 * or not at all with the reason. Filled as the engine resolves songs, so a song not reached yet
 * says so instead of guessing. */

export const SOURCE_WORDS = {
  device: 'From this device',
  hosted: 'From your cloud library',
  pending: 'Checked when it comes up',
} as const;

export function sourceWords(entry: SourceEntry | undefined): string {
  if (!entry) return SOURCE_WORDS.pending;
  if (entry.source === 'unavailable') return entry.reason;
  return SOURCE_WORDS[entry.source];
}

/** `problemsOnly`: an account whose music is all on its own devices has one source, so the list
 * appears only when a song can't play, and names just those songs. */
export function QueueSources({ mix, book, problemsOnly = false, nothingPlays = false }: {
  mix: readonly Pick<MixItem, 'song_id' | 'artist' | 'title'>[]; book: SourceBook; problemsOnly?: boolean;
  /** The player stopped because no song left in the mix can be opened here. */
  nothingPlays?: boolean;
}) {
  const [, redraw] = useState(0);
  useEffect(() => book.subscribe(() => redraw((count) => count + 1)), [book]);
  if (!mix.length) return null;
  const rows = mix.map((item, index) => ({ item, index, entry: book.get(item.song_id) }));
  const missing = nothingPlays ? rows.length : rows.filter((row) => row.entry?.source === 'unavailable').length;
  // A song that can't play is nearly always one this browser was never handed: each browser, even
  // on the same computer, has to be given the music once. So it is one calm line and the one
  // button that fixes it, never an error per song.
  const notHere = missing > 0 && (
    <div className="banner queue-sources" data-tone="info" data-all={missing === rows.length || undefined} role="status" data-testid={problemsOnly ? 'queue-sources' : undefined}>
      <Icon name="folder" />
      <p className="banner-text">
        <b>{missing === rows.length ? 'This browser hasn’t been given this mix’s music yet.' : `This browser hasn’t been given ${missing} of these ${countOf(rows.length, 'song')} yet.`}</b>{' '}
        <span>Each browser needs your music folder once.</span>
      </p>
      <div className="banner-actions"><PageLink to="/library" className="button small">Connect music here</PageLink></div>
    </div>
  );
  if (problemsOnly) return notHere || null;
  const count = (source: string) => rows.filter((row) => (row.entry?.source ?? 'pending') === source).length;
  const summary = [count('device') && `${count('device')} from this device`, count('hosted') && `${count('hosted')} from your cloud library`]
    .filter(Boolean).join(', ');
  return (
    <>
      {notHere}
      <details className="queue-sources queue-sources-list">
        <summary>
          <span id="queue-sources">Where each song plays from</span>
          {summary && <span className="soft"> · {summary}</span>}
        </summary>
        <ol data-testid="queue-sources">
          {rows.map(({ item, index, entry }) => (
            <li key={`${index}-${item.song_id}`} data-source={entry?.source ?? 'pending'}>
              <strong>{item.artist ? `${item.artist} - ${item.title}` : item.title}</strong>
              <span>{entry?.source === 'unavailable' ? 'Not in this browser' : sourceWords(entry)}</span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
