import { useCallback, useEffect, useState } from 'react';
import { Action } from '../ui/controls';
import { CloudError, type Api } from './api';
import { LIBRARY_CHANGED_EVENT } from './cloudLibraryMedia';

/** cloud.one_shell: the songs in the cloud library SelectaDJ could not analyse, each with its
 * reason and Try again, as the older Make a Mix card listed them (GET /api/hosted/songs, then
 * POST /api/hosted/songs/{id}/retry). Shown on Upload music; nothing at all while every song is
 * fine or the answer cannot be read. */

type Song = {
  asset_id: string;
  name: string;
  title?: string | null;
  analysis?: { state?: string; why?: string };
  status?: { state: string; reason?: string | null; can_retry?: boolean };
};

const failed = (song: Song) => (song.status ? song.status.state === 'failed' : song.analysis?.state === 'failed');
const reasonOf = (song: Song) => song.status?.reason ?? song.analysis?.why ?? 'It stopped part way.';
const retryable = (song: Song) => song.status?.can_retry ?? true;
const titleOf = (song: Song) => song.title || song.name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'A song';

export function CloudSongProblems({ api, workspaceId }: { api: Api; workspaceId: string }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [problem, setProblem] = useState('');
  const read = useCallback(async () => {
    try {
      const found = await api<{ songs?: Song[] }>('/hosted/songs', {}, workspaceId);
      setSongs((found.songs ?? []).filter(failed));
    } catch {
      // the list is a convenience: the Library still shows every song
    }
  }, [api, workspaceId]);
  useEffect(() => {
    void read();
    const changed = () => void read();
    window.addEventListener(LIBRARY_CHANGED_EVENT, changed);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, changed);
  }, [read]);
  if (!songs.length) return null;
  const again = async (song: Song) => {
    setProblem('');
    try {
      try {
        await api(`/hosted/songs/${encodeURIComponent(song.asset_id)}/retry`, { method: 'POST', body: '{}' }, workspaceId);
      } catch (first) {
        // a server from before Try again for one song: ask again for every failed one
        if (!(first instanceof CloudError) || (first.status !== 404 && first.status !== 405)) throw first;
        await api('/hosted/songs/prepare', { method: 'POST', body: JSON.stringify({ retry: true }) }, workspaceId);
      }
      setSongs((was) => was.filter((one) => one.asset_id !== song.asset_id));
    } catch (error) {
      setProblem((error as Error).message || 'SelectaDJ could not try that song again.');
    }
  };
  return (
    <section className="cloud-card cloud-song-problems" aria-labelledby="cloud-song-problems-title">
      <h2 id="cloud-song-problems-title">{songs.length === 1 ? 'A song could not be analysed' : `${songs.length} songs could not be analysed`}</h2>
      <ul className="cloud-upload-list">
        {songs.map((song) => (
          <li key={song.asset_id}>
            <span><b dir="auto">{titleOf(song)}</b> <span dir="auto">{reasonOf(song)}</span></span>
            {retryable(song) && <Action className="small" aria-label={`Try ${titleOf(song)} again`} run={() => again(song)} working="Asking…">Try again</Action>}
          </li>
        ))}
      </ul>
      {problem && <p role="alert" className="warn">{problem}</p>}
    </section>
  );
}
