import { useEffect, useState } from 'react';
import type { MixItem } from '../api';
import type { SourceBook, SourceEntry } from '../media';

/** Where each queued song plays from (ADR-0465, BF-0465-03): this device, the hosted library,
 * or not at all with the reason. Filled as the engine resolves songs, so a song not reached yet
 * says so instead of guessing. */

export const SOURCE_WORDS = {
  device: 'From this device',
  hosted: 'From your SelectaDJ Cloud library',
  pending: 'Checked when it comes up',
} as const;

export function sourceWords(entry: SourceEntry | undefined): string {
  if (!entry) return SOURCE_WORDS.pending;
  if (entry.source === 'unavailable') return entry.reason;
  return SOURCE_WORDS[entry.source];
}

/** `problemsOnly`: an account whose music is all on its own devices has one source, so the list
 * appears only when a song can't play, and names just those songs. */
export function QueueSources({ mix, book, problemsOnly = false }: { mix: readonly Pick<MixItem, 'song_id' | 'artist' | 'title'>[]; book: SourceBook; problemsOnly?: boolean }) {
  const [, redraw] = useState(0);
  useEffect(() => book.subscribe(() => redraw((count) => count + 1)), [book]);
  if (!mix.length) return null;
  const rows = mix.map((item, index) => ({ item, index, entry: book.get(item.song_id) }));
  const shown = problemsOnly ? rows.filter((row) => row.entry?.source === 'unavailable') : rows;
  if (!shown.length) return null;
  const count = (source: string) => rows.filter((row) => (row.entry?.source ?? 'pending') === source).length;
  const summary = problemsOnly
    ? `${shown.length} ${shown.length === 1 ? 'song' : 'songs'} can’t play here`
    : [count('device') && `${count('device')} from this device`, count('hosted') && `${count('hosted')} from Cloud`, count('unavailable') && `${count('unavailable')} can’t play`]
      .filter(Boolean).join(', ');
  return (
    <div className="page">
    <details className="panel queue-sources" open={problemsOnly || undefined}>
      <summary>
        <span id="queue-sources">Where each song plays from</span>
        {summary && <span className="soft"> · {summary}</span>}
      </summary>
      <ol className="stack" data-testid="queue-sources">
        {shown.map(({ item, index, entry }) => (
          <li key={`${index}-${item.song_id}`} data-source={entry?.source ?? 'pending'}>
            <strong>{item.artist ? `${item.artist} - ${item.title}` : item.title}</strong>
            {': '}
            <span>{sourceWords(entry)}</span>
          </li>
        ))}
      </ol>
    </details>
    </div>
  );
}
