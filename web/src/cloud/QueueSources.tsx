import { useEffect, useState } from 'react';
import type { MixItem } from '../api';
import type { SourceBook, SourceEntry } from '../media';

/** Where each queued song plays from (ADR-0465, BF-0465-03): this device, the hosted library,
 * or not at all with the reason. Filled as the engine resolves songs, so a song not reached yet
 * says so instead of guessing. */

export const SOURCE_WORDS = {
  device: 'From this device',
  hosted: 'From your SelectaDJ Cloud library',
  pending: 'Not looked for yet',
} as const;

export function sourceWords(entry: SourceEntry | undefined): string {
  if (!entry) return SOURCE_WORDS.pending;
  if (entry.source === 'unavailable') return entry.reason;
  return SOURCE_WORDS[entry.source];
}

export function QueueSources({ mix, book }: { mix: readonly Pick<MixItem, 'song_id' | 'artist' | 'title'>[]; book: SourceBook }) {
  const [, redraw] = useState(0);
  useEffect(() => book.subscribe(() => redraw((count) => count + 1)), [book]);
  if (!mix.length) return null;
  return (
    <section className="panel stack" aria-labelledby="queue-sources">
      <h2 id="queue-sources">Where each song plays from</h2>
      <ol className="stack" data-testid="queue-sources">
        {mix.map((item, index) => {
          const entry = book.get(item.song_id);
          return (
            <li key={`${index}-${item.song_id}`} data-source={entry?.source ?? 'pending'}>
              <strong>{item.artist ? `${item.artist} - ${item.title}` : item.title}</strong>
              {': '}
              <span>{sourceWords(entry)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
