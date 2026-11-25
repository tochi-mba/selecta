import { useEffect, useId, useState } from 'react';
import type { LibrarySong } from '../api';
import { useFlag } from '../flags';
import { catalogImageUrl, chooseCover, readCandidates, useCatalogSong, type CatalogCandidates, type CatalogRelease, type CoverChoice } from '../media/catalogArt';
import { useRequest } from '../requestContext';
import { Action } from '../ui/controls';
import { CoverArt, useSongArt } from './CoverArt';
import type { ViewProps } from './shared';

// What SelectaDJ's own catalogue knows about a song, in its details (ADR-0478, FL-0478-04, flag
// `library.art_lookup`): "Wrong cover?" for a song showing a catalogue cover, and the album and
// release year offered as suggestions. A suggestion is only ever shown beside the song: the file's
// own tags are never changed by it. Nothing here is drawn while the flag is off, in the local app
// (which has no catalogue), or for a song whose file has a picture of its own.

const releaseWords = (release: CatalogRelease) => [release.year, release.type, release.status === 'Official' ? null : release.status]
  .filter((part) => part !== null && part !== undefined && part !== '')
  .join(', ');

const coverWords = (release: CatalogRelease) => {
  if (release.art) return '';
  return release.cover === 'absent' ? 'Has no cover' : 'Cover fetched when you choose it';
};

export function SongCatalog({ song, notify }: { song: LibrarySong; notify: ViewProps['notify'] }) {
  const shown = useFlag('library.art_lookup');
  const request = useRequest();
  const entry = useCatalogSong(shown ? song.id : null);
  const own = useSongArt(shown ? song.id : null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CatalogCandidates | null>(null);
  const [problem, setProblem] = useState('');
  const pickerId = useId();

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setProblem('');
    readCandidates(request, song.id).then(
      (found) => { if (live) setList(found); },
      () => { if (live) setProblem('The other covers could not be read just now. Try again in a moment.'); },
    );
    return () => { live = false; };
  }, [open, request, song.id]);

  if (!shown || !entry) return null;
  const fileHasCover = !!(own.small ?? own.large);
  // the person can change a catalogue cover, or change their mind after choosing the tile
  const canChange = !fileHasCover && (entry.state === 'matched' || entry.state === 'generated');
  const details = entry.state === 'matched' ? entry.details : null;
  const suggestAlbum = details?.album?.trim() || null;
  const year = details?.year ?? null;

  const choose = async (choice: CoverChoice, said: string): Promise<boolean> => {
    setProblem('');
    try {
      const { pending } = await chooseCover(request, song.id, choice);
      notify(pending ? `${said} The cover is being fetched and shows in a moment.` : said);
      setList(await readCandidates(request, song.id).catch(() => list));
      return true;
    } catch {
      setProblem('Your choice was not saved. The cover is as it was. Try again in a moment.');
      return false;
    }
  };

  if (!canChange && !suggestAlbum && year === null) return null;
  return (
    <section className="stack song-catalog" aria-label="From SelectaDJ’s catalogue">
      {(suggestAlbum || year !== null) && (
        <>
          <dl className="song-facts song-catalog-facts">
            {suggestAlbum && <div><dt>Album</dt><dd dir="auto">{suggestAlbum}</dd></div>}
            {year !== null && <div><dt>Release year</dt><dd>{year}</dd></div>}
          </dl>
          <p className="hint">Suggested by SelectaDJ’s catalogue. Your file’s own tags are not changed.</p>
        </>
      )}
      {canChange && (
        <div className="row wrap">
          <button type="button" className="song-catalog-toggle" aria-expanded={open} aria-controls={pickerId} onClick={() => setOpen((was) => !was)}>
            Wrong cover?
          </button>
        </div>
      )}
      {canChange && open && (
        <div className="song-catalog-picker" id={pickerId} role="group" aria-label="Choose this song’s cover">
          {list === null && !problem && <p className="hint" role="status">Reading the other covers…</p>}
          {list && (
            <ul className="song-catalog-choices">
              {list.releases.map((release) => {
                const current = release.current && list.choice !== 'generated';
                const url = catalogImageUrl(release.art?.url);
                const words = [releaseWords(release), coverWords(release)].filter(Boolean).join('. ');
                return (
                  <li key={release.release_id}>
                    <Action className="song-catalog-choice" aria-pressed={current}
                      run={() => choose({ choice: 'release', release_id: release.release_id }, `Cover changed to ${release.title}.`)}>
                      <span className="song-catalog-thumb"><CoverArt seed={release.release_id} size="small" artUrl={url ?? undefined} artHue={release.art?.hue ?? null} /></span>
                      <span className="song-catalog-words">
                        <span dir="auto">{release.title}</span>
                        {words && <span className="hint">{words}</span>}
                      </span>
                    </Action>
                  </li>
                );
              })}
              <li>
                <Action className="song-catalog-choice" aria-pressed={list.choice === 'generated'}
                  run={() => choose({ choice: 'generated' }, 'This song shows its generated tile now.')}>
                  <span className="song-catalog-thumb"><CoverArt seed={song.id} size="small" /></span>
                  <span className="song-catalog-words"><span>The generated tile</span></span>
                </Action>
              </li>
            </ul>
          )}
          {list && list.choice !== 'auto' && (
            <div className="row wrap">
              <Action run={() => choose({ choice: 'auto' }, 'SelectaDJ will choose this song’s cover again.')}>Let SelectaDJ choose</Action>
            </div>
          )}
          {problem && <p className="warn" role="alert">{problem}</p>}
        </div>
      )}
    </section>
  );
}
