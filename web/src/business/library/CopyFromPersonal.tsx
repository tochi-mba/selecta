// "Copy from my personal library" (ADR-0453 D6 step 6): an owner or admin picks songs from their
// own SelectaDJ library and the organisation gets its own copies. Copy, never move: the personal
// library is untouched. The note says plainly that personal downloads are often licensed for
// personal use only, so the venue checks it may play them in public.

import { useEffect, useState } from 'react';
import type { Api } from '../../cloud/api';
import { useBusiness } from '../context';

export const COPY_PERSONAL = {
  heading: 'Copy from my personal library',
  note: 'This copies songs; your personal library stays as it is. Music bought or downloaded for personal listening is often licensed for personal use only, so check the venue may play it in public.',
  loading: 'Loading your personal library',
  failed: "Couldn't load your personal library.",
  empty: 'Your personal library has no songs to copy.',
  copy: (n: number) => (n === 1 ? 'Copy 1 song' : `Copy ${n} songs`),
  copying: 'Copying',
  done: (copied: number, skipped: number) => `Copied ${copied} ${copied === 1 ? 'song' : 'songs'}${skipped ? `; ${skipped} already here` : ''}.`,
  refused: (n: number) => ` ${n} couldn't be copied (storage full or unavailable).`,
} as const;

type PersonalSong = { id: string; name: string };

export function CopyFromPersonal({ api, personalWorkspaceId, onCopied }: { api: Api; personalWorkspaceId: string; onCopied: () => void }) {
  const { client, readOnly, offline } = useBusiness();
  const [songs, setSongs] = useState<PersonalSong[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    let live = true;
    api<{ assets: PersonalSong[] }>('/assets?limit=200', {}, personalWorkspaceId)
      .then((answer) => { if (live) setSongs(answer.assets ?? []); })
      .catch(() => { if (live) setError(COPY_PERSONAL.failed); });
    return () => { live = false; };
  }, [api, personalWorkspaceId]);
  const toggle = (id: string) => setPicked((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const copy = async () => {
    setWorking(true); setSaid(''); setError('');
    try {
      const result = await client.copyFromPersonal([...picked]);
      setSaid(COPY_PERSONAL.done(result.copied, result.skipped) + (result.refused ? COPY_PERSONAL.refused(result.refused) : ''));
      setPicked(new Set());
      onCopied();
    } catch (problem) { setError((problem as Error).message); }
    finally { setWorking(false); }
  };
  return (
    <section className="biz-card biz-stack" aria-labelledby="biz-copy-personal">
      <h2 id="biz-copy-personal">{COPY_PERSONAL.heading}</h2>
      <p>{COPY_PERSONAL.note}</p>
      {!songs && !error && <p role="status">{COPY_PERSONAL.loading}</p>}
      {songs && !songs.length && <p>{COPY_PERSONAL.empty}</p>}
      {songs && songs.length > 0 && <ul className="biz-stack">
        {songs.map((song) => <li key={song.id}><label><input type="checkbox" checked={picked.has(song.id)} onChange={() => toggle(song.id)} /> {song.name}</label></li>)}
      </ul>}
      {songs && songs.length > 0 && <button type="button" disabled={!picked.size || working || readOnly || offline} onClick={() => { void copy(); }}>
        {working ? COPY_PERSONAL.copying : COPY_PERSONAL.copy(picked.size)}
      </button>}
      {said && <p role="status">{said}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
