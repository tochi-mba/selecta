// BlocklistEditor (ADR-0450, ADR-0453 D14): find a song or artist and add it to never play; remove
// entries again. Blocklists never relax to fill silence.

import { useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { Combobox } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import type { LibrarySong } from '../client';
import { VENUE_COPY } from '../copy/venue';
import type { ContentRules } from '../types';

export type BlockEntry = ContentRules['blocklist'][number];

export function BlocklistEditor({ items, songs, onChange, disabled }: {
  items: BlockEntry[];
  songs: LibrarySong[];
  onChange: (items: BlockEntry[]) => Promise<void>;
  disabled?: string | null;
}) {
  const [query, setQuery] = useState('');
  const off = disabled != null;
  const choices = useMemo(() => {
    const words = query.trim().toLowerCase();
    const artists = [...new Set(songs.map((song) => song.artist))];
    const all: (BlockEntry & { value: string })[] = [
      ...artists.map((artist) => ({ kind: 'artist' as const, id: artist, label: artist, value: `artist:${artist}` })),
      ...songs.map((song) => ({ kind: 'song' as const, id: song.id, label: `${song.title} by ${song.artist}`, value: `song:${song.id}` })),
    ];
    return all.filter((entry) => !items.some((item) => item.kind === entry.kind && item.id === entry.id) && (!words || entry.label.toLowerCase().includes(words))).slice(0, 20);
  }, [query, songs, items]);
  const add = async (value: string) => {
    const entry = choices.find((choice) => choice.value === value);
    if (!entry) return;
    await onChange([...items, { kind: entry.kind, id: entry.id, label: entry.label }]);
    setQuery('');
    showToast(VENUE_COPY.blocklistAdded(entry.label));
  };
  return <section className="biz-stack" aria-labelledby="blocklist-title">
    <h3 id="blocklist-title">{VENUE_COPY.blocklistHeading}</h3>
    <Combobox label={VENUE_COPY.blocklistFind} value={query} onChange={setQuery} disabled={off}
      options={choices.map((choice) => ({ value: choice.value, label: `${choice.kind === 'artist' ? VENUE_COPY.blocklistArtist : VENUE_COPY.blocklistSong}: ${choice.label}` }))}
      onPick={(value) => { void add(value); }} />
    {disabled && <p className="biz-quiet">{disabled}</p>}
    {!items.length ? <p className="biz-quiet">{VENUE_COPY.blocklistNone}</p> : <ul className="venue-list">
      {items.map((item) => <li key={`${item.kind}:${item.id}`} className="biz-row">
        <span className="biz-clamp" title={item.label}>{item.kind === 'artist' ? VENUE_COPY.blocklistArtist : VENUE_COPY.blocklistSong}: {item.label}</span>
        <Action disabled={off} run={() => onChange(items.filter((other) => other !== item))}>{VENUE_COPY.blocklistRemove(item.label)}</Action>
      </li>)}
    </ul>}
  </section>;
}
