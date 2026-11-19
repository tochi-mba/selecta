// The song sheet (ADR-0450, BZ-0450-03): find a song in the organisation library, mark it
// explicit, clean or not checked, and link its clean edit. Venue managers and above may change
// it; everyone else sees it read-only (the server checks `business.songs.flag` at this venue).

import { useMemo, useState } from 'react';
import { Select } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import type { LibrarySong } from '../client';
import type { ContentClient, Explicit, SongSheet as Sheet } from './contentClient';

const MARKS: { value: Explicit; label: string }[] = [
  { value: 'unknown', label: 'Not checked' }, { value: 'clean', label: 'Clean' }, { value: 'explicit', label: 'Explicit' },
];
const NONE = '';

export function SongSheet({ tools, songs, venueId, disabled, canEdit }: {
  tools: ContentClient; songs: LibrarySong[]; venueId: string; disabled: string | null; canEdit: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState('');
  const off = disabled != null || !canEdit;
  const found = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words ? songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(words)).slice(0, 10) : [];
  }, [query, songs]);
  const open = async (id: string) => {
    setError('');
    try { setSheet(await tools.song(id, venueId)); } catch { setError("Couldn't open that song. Try again."); }
  };
  const save = async (change: () => Promise<unknown>, done: string) => {
    if (!sheet) return;
    setError('');
    try { await change(); setSheet(await tools.song(sheet.song_id, venueId)); showToast(done); }
    catch { setError("That change couldn't be saved. Try again."); }
  };
  return <section className="biz-stack" aria-labelledby="song-sheet-title">
    <h3 id="song-sheet-title">Song sheet</h3>
    <label className="field">Find a song<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {found.length > 0 && <ul className="venue-list" aria-label="Songs found">
      {found.map((song) => <li key={song.id}><button type="button" onClick={() => void open(song.id)}>{song.title} by {song.artist}</button></li>)}
    </ul>}
    {sheet && <div className="biz-stack" aria-label={`${sheet.title} sheet`}>
      <h4>{sheet.title} by {sheet.artist}</h4>
      {sheet.source && <p className="biz-quiet">Marked by {sheet.source === 'tag' ? 'the file\'s own tags' : sheet.source === 'manual' ? 'a person' : `a ${sheet.source}`}.</p>}
      <Select label="Explicit lyrics" value={sheet.explicit} disabled={off} options={MARKS}
        onChange={(explicit) => void save(() => tools.setFlag(sheet.song_id, explicit, venueId), `${sheet.title} marked ${MARKS.find((m) => m.value === explicit)?.label.toLowerCase()}`)} />
      <Select label="Clean edit" value={sheet.clean_song_id ?? NONE} disabled={off}
        options={[{ value: NONE, label: 'None' }, ...songs.filter((song) => song.id !== sheet.song_id).map((song) => ({ value: song.id, label: `${song.title} by ${song.artist}` }))]}
        onChange={(clean) => void save(() => tools.setCleanLink(sheet.song_id, clean || null, venueId), clean ? 'Clean edit linked' : 'Clean edit removed')} />
      <p className="biz-quiet">Where the explicit song can't play, its clean edit may play instead.</p>
      {!canEdit && <p className="biz-quiet">Venue managers and above can change this.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
