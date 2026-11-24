import type { LibrarySong, SongVersion } from '../api';
import { clock } from '../lib';
import { useApi } from '../requestContext';
import { Action } from '../ui/controls';
import type { ViewProps } from './shared';

// The files of one song (ADR-0469 amendment 2): shown in the song's details, never as rows of
// their own. One is the id the song is known by; an extra copy can be taken out of the library,
// which never touches the file itself.

function versionWords(version: SongVersion): string {
  const parts = [version.length > 0 ? clock(version.length) : 'Length not known'];
  if (version.format) parts.push(version.format.toUpperCase());
  parts.push(version.here ? 'on this device' : 'not on this device');
  return parts.join(', ');
}

export function SongVersions({ song, onChanged, notify }: { song: LibrarySong; onChanged: () => void; notify: ViewProps['notify'] }) {
  const { del } = useApi();
  const versions = song.versions ?? [];
  if (versions.length < 2) return null;
  const remove = async (version: SongVersion) => {
    await del(`/local-media/songs/${version.id}`);
    notify('The extra copy is out of your library. The file itself is where it was.');
    onChanged();
  };
  return (
    <section className="song-versions" aria-labelledby={`song-versions-${song.id}`}>
      <h3 className="section-title" id={`song-versions-${song.id}`}>{versions.length} versions</h3>
      <p className="hint">Files of this same recording, from different folders or formats. SelectaDJ shows them as one song and plays the best one the device has.</p>
      <dl className="song-facts song-facts-table">
        {versions.map((version) => (
          <div key={version.id}>
            <dt>{version.primary ? 'Known by' : 'Extra copy'}</dt>
            <dd>
              {versionWords(version)}
              {!version.primary && (
                <> <Action className="quiet" run={() => remove(version)} working="Removing…">Remove the extra copy from my library</Action></>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
