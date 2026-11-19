// The ADR-0450 tools under a venue's Music rules: what each zone can really play (with any rule
// the pool had to relax, and how many songs are still unchecked), 24-hour overrides, the bulk
// editor by search and filters with undo, the CSV import with its match preview, and the
// "Worth checking" list. Each part shows only while its flag is on, and the page reflows.

import { useMemo, useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import { businessOn, useBusiness } from '../context';
import type { Venue, Zone } from '../types';
import { useLoad } from '../venue/useVenue';
import { BlocklistMore } from './BlocklistMore';
import { SongSheet } from './SongSheet';
import { contentClient, endsWords, type BulkApplied, type ContentClient, type CsvMatch, type Explicit, type Selection, type WorthChecking } from './contentClient';

const EXPLICIT_CHOICES: { value: Explicit; label: string }[] = [
  { value: 'clean', label: 'Clean' }, { value: 'explicit', label: 'Explicit' }, { value: 'unknown', label: 'Not checked' },
];

function problemWords(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { detail?: { message?: string } } })?.payload;
  return payload?.detail?.message ?? fallback;
}

function ZonePool({ zone, tools, disabled, now }: { zone: Zone; tools: ContentClient; disabled: string | null; now: number }) {
  const pool = useLoad(() => tools.pool(zone.id), [tools, zone.id]);
  const [kind, setKind] = useState<'song' | 'artist'>('artist');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('4');
  const [error, setError] = useState('');
  const off = disabled != null;
  if (pool.error && !pool.data) return <p role="alert">Couldn't read what {zone.name} can play. <button type="button" onClick={() => { void pool.reload(); }}>Retry</button></p>;
  if (!pool.data) return <p role="status">Reading {zone.name}</p>;
  const data = pool.data;
  return <section className="biz-stack" aria-label={`${zone.name} pool`}>
    <h4>{zone.name}</h4>
    {data.unanalysed > 0 && <p className="biz-quiet">{data.unanalysed} of {data.library} songs aren't analysed yet, so they can't play here until they are.</p>}
    <ul className="venue-list">
      {data.blocks.map((block) => <li key={block.daypart_id ?? 'all'}>
        <strong>{block.label}</strong>: {block.songs} songs, about {block.hours} hours. {block.unknown > 0 && `${block.unknown} not checked for explicit lyrics.`}
        {block.songs === 0 && <span className="warn"> Nothing can play here with these rules.</span>}
        {block.messages.map((message) => <p key={message} className="warn">{message}</p>)}
      </li>)}
    </ul>
    <h5>Overrides</h5>
    {!data.overrides.length && <p className="biz-quiet">No overrides in {zone.name}.</p>}
    <ul className="venue-list">{data.overrides.map((item) => <li key={item.id} className="biz-row">
      <span>{item.kind === 'artist' ? 'Artist' : 'Song'} {item.value} allowed. {item.reason}. {endsWords(item.ends_at, now)}.</span>
      <Action disabled={off} run={async () => { await tools.endOverride(zone.id, item.id); await pool.reload(); }}>End override</Action>
    </li>)}</ul>
    <fieldset className="venue-fields" disabled={off}>
      <legend>Allow one song or artist in {zone.name} for a while</legend>
      <Select label="Allow" value={kind} disabled={off} onChange={setKind} options={[{ value: 'artist', label: 'An artist' }, { value: 'song', label: 'A song (its id)' }]} />
      <TextField label={kind === 'artist' ? 'Artist' : 'Song id'} value={value} disabled={off} onChange={setValue} />
      <TextField label="Reason" value={reason} disabled={off} onChange={setReason} help="For example: private event. Clean only zones stay clean." />
      <TextField type="number" label="For how many hours (up to 24)" value={hours} disabled={off} onChange={setHours} />
      <Action disabled={off || !value.trim() || !reason.trim()} run={async () => {
        setError('');
        const minutes = Math.round(Math.min(24, Math.max(0.25, Number(hours) || 1)) * 60);
        try {
          await tools.addOverride(zone.id, { kind, value: value.trim(), reason: reason.trim(), minutes });
          setValue(''); setReason('');
          showToast(`Override added in ${zone.name}`);
          await pool.reload();
        } catch (problem) { setError(problemWords(problem, "The override couldn't be added. Try again.")); }
      }}>Add override</Action>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  </section>;
}

function BulkByFilter({ tools, disabled }: { tools: ContentClient; disabled: string | null }) {
  const [selection, setSelection] = useState<Selection>({ explicit: 'clean', query: '', unknown_only: true, artist: '' });
  const [summary, setSummary] = useState('');
  const [last, setLast] = useState<BulkApplied | null>(null);
  const [error, setError] = useState('');
  const off = disabled != null;
  const body = (): Selection => ({ ...selection, query: selection.query || null, artist: selection.artist || null });
  return <section className="biz-stack" aria-labelledby="bulk-filter-title">
    <h3 id="bulk-filter-title">Mark many songs at once</h3>
    <p className="biz-quiet">Pick songs by search and filters, see how many change, then mark them. You can undo the last change.</p>
    <TextField label="Search titles and artists" value={selection.query ?? ''} disabled={off} onChange={(query) => setSelection({ ...selection, query })} />
    <TextField label="Only this artist" value={selection.artist ?? ''} disabled={off} onChange={(artist) => setSelection({ ...selection, artist })} />
    <label className="venue-check"><input type="checkbox" checked={!!selection.unknown_only} disabled={off} onChange={(event) => setSelection({ ...selection, unknown_only: event.target.checked })} /><span>Only songs not checked yet</span></label>
    <Select label="Mark them as" value={selection.explicit} disabled={off} onChange={(explicit) => setSelection({ ...selection, explicit })} options={EXPLICIT_CHOICES} />
    <div className="biz-row">
      <Action disabled={off} run={async () => { setError(''); try { setSummary((await tools.bulkPreview(body())).summary); } catch (problem) { setError(problemWords(problem, "Couldn't count those songs.")); } }}>Count songs</Action>
      <Action disabled={off || !summary} run={async () => {
        setError('');
        try { const done = await tools.bulkApply(body()); setLast(done); setSummary(''); showToast(done.summary); }
        catch (problem) { setError(problemWords(problem, "Those songs couldn't be marked. Try again.")); }
      }}>Mark them</Action>
      {last && <Action disabled={off} run={async () => { await tools.bulkUndo(last.batch_id); showToast(`Undid: ${last.summary}`); setLast(null); }}>Undo last change</Action>}
    </div>
    {summary && <p role="status">{summary}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function CsvImport({ tools, disabled }: { tools: ContentClient; disabled: string | null }) {
  const [text, setText] = useState('');
  const [match, setMatch] = useState<CsvMatch | null>(null);
  const [error, setError] = useState('');
  const off = disabled != null;
  const rows = (label: string, list: CsvMatch['ambiguous']) => list.length > 0 && <details><summary>{label} ({list.length})</summary>
    <ul className="venue-list">{list.slice(0, 50).map((row) => <li key={row.line}>Line {row.line}: {row.artist ?? ''} {row.title ? `- ${row.title}` : ''} {row.why ?? ''}</li>)}</ul></details>;
  return <section className="biz-stack" aria-labelledby="csv-title">
    <h3 id="csv-title">Import marks from a CSV</h3>
    <p className="biz-quiet">Columns: isrc, artist, title, explicit (explicit, clean or unknown). Rows match by ISRC first, then exact artist and title. Only matched rows are saved.</p>
    <label className="field">CSV file<input type="file" accept=".csv,text/csv" disabled={off} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { setText(await file.text()); setMatch(null); } }} /></label>
    <label className="field">Or paste it<textarea rows={4} value={text} disabled={off} onChange={(event) => { setText(event.target.value); setMatch(null); }} /></label>
    <div className="biz-row">
      <Action disabled={off || !text.trim()} run={async () => { setError(''); try { setMatch(await tools.importPreview(text)); } catch (problem) { setError(problemWords(problem, "Couldn't read that CSV.")); } }}>Check matches</Action>
      <Action disabled={off || !match?.counts.matched} run={async () => {
        setError('');
        try { const done = await tools.importApply(text); showToast(`Marked ${done.count} songs from the CSV`); setMatch(null); setText(''); }
        catch (problem) { setError(problemWords(problem, "The import couldn't be saved. Try again.")); }
      }}>Save {match?.counts.matched ?? 0} matched</Action>
    </div>
    {match && <div role="status"><p>{match.counts.matched} matched, {match.counts.ambiguous} ambiguous, {match.counts.unmatched} unmatched, {match.counts.invalid} not readable.</p>
      {rows('Ambiguous', match.ambiguous)}{rows('Unmatched', match.unmatched)}{rows('Not readable', match.invalid)}</div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function WorthCheckingList({ tools, disabled }: { tools: ContentClient; disabled: string | null }) {
  const [found, setFound] = useState<WorthChecking | null>(null);
  const [error, setError] = useState('');
  return <section className="biz-stack" aria-labelledby="worth-title">
    <h3 id="worth-title">Worth checking</h3>
    <p className="biz-quiet">Songs whose lyrics contain words on a review list. This only suggests: it never marks a song. Lyrics come from LRCLIB and miss many songs.</p>
    <Action disabled={disabled != null} run={async () => { setError(''); try { setFound(await tools.worthChecking()); } catch (problem) { setError(problemWords(problem, "Couldn't check lyrics right now.")); } }}>Check more songs</Action>
    {found && <>
      <p role="status">{found.checked} of {found.library} songs checked so far. {found.not_checked.length} had no lyrics to check.</p>
      {!found.worth_checking.length ? <p className="biz-quiet">Nothing to check yet.</p> : <ul className="venue-list">
        {found.worth_checking.map((hint) => <li key={hint.song_id}>{hint.title} by {hint.artist} ({hint.words?.join(', ')})</li>)}
      </ul>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ContentTools({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { api, org, now, client } = useBusiness();
  const songs = useLoad(async () => (await client.librarySongs?.(org.id).catch(() => [])) ?? [], [client, org.id]);
  const tools = useMemo(() => (api ? contentClient(api, org.id) : null), [api, org.id]);
  if (!tools || !businessOn(org.features, 'business.content_controls')) return null;
  return <div className="biz-stack">
    <div className="biz-card biz-stack">
      <h3>What each zone can play</h3>
      {venue.zones.map((zone) => <ZonePool key={zone.id} zone={zone} tools={tools} disabled={disabled} now={now} />)}
    </div>
    <div className="biz-card"><BlocklistMore tools={tools} venueId={venue.id} disabled={disabled} /></div>
    <div className="biz-card"><SongSheet tools={tools} songs={songs.data ?? []} venueId={venue.id} disabled={disabled}
      canEdit={['owner', 'admin', 'venue_manager'].includes(org.role)} /></div>
    {businessOn(org.features, 'business.content_controls.bulk') && <>
      <div className="biz-card"><BulkByFilter tools={tools} disabled={disabled} /></div>
      <div className="biz-card"><CsvImport tools={tools} disabled={disabled} /></div>
    </>}
    {businessOn(org.features, 'business.content_controls.lyrics_hint') && <div className="biz-card"><WorthCheckingList tools={tools} disabled={disabled} /></div>}
  </div>;
}
