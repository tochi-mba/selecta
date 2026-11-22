// More blocklist entries (ADR-0450, BZ-0450-06): block an artist (after seeing every spelling it
// will match, featured credits included), an album or a library tag, for the whole organisation
// or this venue, with an optional end date and a reason. Blocklists never relax to fill silence.

import { useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import { useLoad } from '../venue/useVenue';
import type { BlockKind, ContentClient } from './contentClient';

type Kind = Exclude<BlockKind, 'song'>;
const KINDS: { value: Kind; label: string }[] = [{ value: 'artist', label: 'An artist' }, { value: 'album', label: 'An album' }, { value: 'tag', label: 'A library tag or genre' }];
const KIND_WORDS: Record<BlockKind, string> = { song: 'Song', artist: 'Artist', album: 'Album', tag: 'Tag' };

export function BlocklistMore({ tools, venueId, disabled }: { tools: ContentClient; venueId: string; disabled: string | null }) {
  const entries = useLoad(() => tools.blocklist(), [tools]);
  const [kind, setKind] = useState<Kind>('artist');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<'organisation' | 'venue'>('venue');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [variants, setVariants] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const off = disabled != null;
  const needsPreview = kind === 'artist' && variants === null;
  const reset = () => { setValue(''); setReason(''); setUntil(''); setVariants(null); };
  const shown = (entries.data ?? []).filter((entry) => entry.scope === 'organisation' || entry.scope_id === venueId);
  return <section className="biz-stack" aria-labelledby="block-more-title">
    <h3 id="block-more-title">Never play an artist, album or tag</h3>
    <fieldset className="venue-fields" disabled={off}>
      <Select label="Block" value={kind} disabled={off} options={KINDS} onChange={(next) => { setKind(next); setVariants(null); }} />
      <TextField label={`${KIND_WORDS[kind]} to block`} value={value} disabled={off} onChange={(text) => { setValue(text); setVariants(null); }} />
      <Select label="Where" value={scope} disabled={off} options={[{ value: 'venue', label: 'This venue' }, { value: 'organisation', label: 'Every venue' }]} onChange={setScope} />
      <TextField label="Reason" value={reason} disabled={off} onChange={setReason} />
      <label className="field">Ends on (optional)<input type="date" value={until} disabled={off} onChange={(event) => setUntil(event.target.value)} /></label>
      {kind === 'artist' && <Action disabled={off || !value.trim()} run={async () => setVariants(await tools.variants(value.trim()))}>Check spellings</Action>}
      {variants !== null && <div role="status">{variants.length
        ? <><p>This also blocks every song credited to:</p><ul className="venue-list">{variants.map((name) => <li key={name}>{name}</li>)}</ul></>
        : <p>No song in the library matches that artist yet. It will still be blocked if one arrives.</p>}</div>}
      <Action disabled={off || !value.trim() || needsPreview} run={async () => {
        setError('');
        const ends = until ? new Date(`${until}T23:59:59`).getTime() / 1000 : null;
        try {
          const done = await tools.addBlock({ kind, value: value.trim(), scope, scope_id: venueId, reason: reason.trim() || null, ends_at: ends });
          showToast(done.ended_overrides.length ? `${value.trim()} blocked; ${done.ended_overrides.length} override ended` : `${value.trim()} blocked`);
          reset();
          await entries.reload();
        } catch { setError("That entry couldn't be added. Check it and try again."); }
      }}>Add to the blocklist</Action>
    </fieldset>
    {needsPreview && value.trim() && <p className="biz-quiet">Check the spellings first, so you see every artist this blocks.</p>}
    {error && <p role="alert">{error}</p>}
    {shown.filter((entry) => entry.kind !== 'song').length > 0 && <ul className="venue-list" aria-label="Blocked artists, albums and tags">
      {shown.filter((entry) => entry.kind !== 'song').map((entry) => <li key={entry.id} className="biz-row">
        <span>{KIND_WORDS[entry.kind]}: {entry.label}{entry.scope === 'organisation' ? ' (every venue)' : ''}{entry.reason ? `. ${entry.reason}` : ''}</span>
        <Action disabled={off} run={async () => { await tools.removeBlock(entry.id); await entries.reload(); }}>Remove {entry.label}</Action>
      </li>)}
    </ul>}
  </section>;
}
