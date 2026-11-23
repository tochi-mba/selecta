import { useEffect, useState } from 'react';
import type { MixItem } from '../api';
import type { SourceBook, SourceEntry } from '../media';
import { PageLink } from '../shell/PageLink';
import { Icon } from '../ui/Icon';

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
  if (problemsOnly) {
    // one calm line and the one thing that fixes it: the songs are named, never listed like a log
    const names = shown.map((row) => row.item.title);
    const said = names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    return (
      <div className="banner queue-sources" data-tone="warn" role="status" data-testid="queue-sources">
        <Icon name="warning" />
        <p className="banner-text">
          <b>{summary}.</b>{' '}
          <span>Connect {names.length === 1 ? 'it' : 'them'} again to hear {said}.</span>
        </p>
        <div className="banner-actions"><PageLink to="/library" className="button small">Connect music</PageLink></div>
      </div>
    );
  }
  return (
    <details className="queue-sources queue-sources-list">
      <summary>
        <span id="queue-sources">Where each song plays from</span>
        {summary && <span className="soft"> · {summary}</span>}
      </summary>
      <ol data-testid="queue-sources">
        {shown.map(({ item, index, entry }) => (
          <li key={`${index}-${item.song_id}`} data-source={entry?.source ?? 'pending'}>
            <strong>{item.artist ? `${item.artist} - ${item.title}` : item.title}</strong>
            <span>{sourceWords(entry)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
