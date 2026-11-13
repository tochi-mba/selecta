// ExplicitBulkEditor (ADR-0450, ADR-0453 D14): pick songs in a table and mark them explicit or not
// in one go. Analysis can't hear explicit lyrics reliably, so the mark comes from people.

import { useState } from 'react';
import { Action, Status } from '../../ui/controls';
import { DataTable, type Column } from '../../ui/DataTable';
import { showToast } from '../../ui/toasts';
import type { LibrarySong } from '../client';
import { VENUE_COPY } from '../copy/venue';

export function ExplicitBulkEditor({ songs, onMark, disabled }: {
  songs: LibrarySong[];
  onMark: (ids: string[], explicit: 'explicit' | 'clean') => Promise<void>;
  disabled?: string | null;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const off = disabled != null;
  const toggle = (id: string, on: boolean) => setChosen((current) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const columns: Column<LibrarySong>[] = [
    { key: 'pick', label: 'Pick', render: (song) => <input type="checkbox" aria-label={VENUE_COPY.selectSong(song.title)} checked={chosen.has(song.id)} disabled={off} onChange={(event) => toggle(song.id, event.target.checked)} /> },
    { key: 'title', label: VENUE_COPY.explicitColumnSong, render: (song) => <span className="biz-clamp" title={song.title}>{song.title}</span> },
    { key: 'artist', label: VENUE_COPY.explicitColumnArtist, render: (song) => <span className="biz-clamp" title={song.artist}>{song.artist}</span> },
    { key: 'explicit', label: VENUE_COPY.explicitColumnNow, render: (song) => song.explicit === 'explicit' ? <Status kind="warning">{VENUE_COPY.explicitYes}</Status> : <Status kind="planned">{VENUE_COPY.explicitNo}</Status> },
  ];
  const ids = [...chosen];
  const mark = async (explicit: 'explicit' | 'clean') => {
    await onMark(ids, explicit);
    showToast(VENUE_COPY.marked(ids.length));
    setChosen(new Set());
  };
  return <section className="biz-stack" aria-labelledby="explicit-title">
    <h3 id="explicit-title">{VENUE_COPY.explicitHeading}</h3>
    <p className="biz-quiet">{VENUE_COPY.explicitHelp}</p>
    <DataTable caption={VENUE_COPY.explicitHeading} columns={columns} rows={songs} rowKey={(song) => song.id} empty={VENUE_COPY.noSongs} />
    <div className="biz-row">
      <Action disabled={off || !ids.length} run={() => mark('explicit')}>{VENUE_COPY.markExplicit(ids.length)}</Action>
      <Action disabled={off || !ids.length} run={() => mark('clean')}>{VENUE_COPY.markClean(ids.length)}</Action>
      {disabled && <span className="biz-quiet">{disabled}</span>}
    </div>
  </section>;
}
