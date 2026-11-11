import { useEffect, useState } from 'react';
import { get, LibrarySong, LinkList } from '../api';
import { Status } from '../ui/controls';

/** CI-0177-05: the word connections Selecta has actually found for this one song, from the server's
 * own link list. Each says whether it has been heard and kept or is still only a candidate; nothing is
 * guessed, and a song whose lyrics aren't timed yet says so rather than claiming it has no connections. */
export function SongRelated({ song }: { song: Pick<LibrarySong, 'id' | 'lyric_status'> }) {
  const [found, setFound] = useState<LinkList['links'] | null>(null);
  const [failed, setFailed] = useState(false);
  const timed = song.lyric_status === 'synced';
  useEffect(() => {
    if (!timed) return;
    let live = true;
    setFound(null);
    setFailed(false);
    get<LinkList>(`/links?song=${song.id}&limit=12`)
      .then((answer) => { if (live) setFound(answer.links.filter((link) => link.a === song.id || link.b === song.id)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [song.id, timed]);

  return (
    <section className="stack song-related" aria-label="Connected songs">
      <h3>Connected songs</h3>
      {!timed ? (
        <p className="hint">Connections show once this song’s lyrics are timed. None are known yet.</p>
      ) : failed ? (
        <p className="hint" role="status">Couldn’t check its connections just now.</p>
      ) : found === null ? (
        <p className="hint" role="status">Checking…</p>
      ) : found.length === 0 ? (
        <p className="hint">No word connections found with your other songs yet.</p>
      ) : (
        <ul className="song-related-list">
          {found.map((link) => {
            const other = link.a === song.id ? { artist: link.artist_b, title: link.title_b } : { artist: link.artist_a, title: link.title_a };
            const kept = link.state.status === 'ready' && link.state.passed === true && !link.state.fell_back;
            return (
              <li key={`${link.a}-${link.b}-${link.phrase}`}>
                <span dir="auto">“{link.phrase}”</span> with <span dir="auto">{other.title}</span> by <span dir="auto">{other.artist}</span>{' '}
                <Status kind={kept ? 'ready' : 'planned'}>{kept ? 'Heard and kept' : 'Candidate, not heard yet'}</Status>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
