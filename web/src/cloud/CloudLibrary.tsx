import { useContext, useRef, useState } from 'react';
import { HolderContext } from '../devices/controller';
import { dirPicker, type ImportSummary } from '../media';
import { Menu, Status } from '../ui/controls';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Library } from '../views/Library';
import type { ViewProps } from '../views/shared';
import { ConnectMusic, summaryWords, type ConnectMusicHandle } from './ConnectMusic';
import { formatCount } from './ImportStatus';
import { useImportSession } from './importSession';
import './libraryWorkspace.css';

const KEEP_SAID = 'selecta.library.keep-said';

type ConnectProps = Omit<Parameters<typeof ConnectMusic>[0], 'variant' | 'ref'>;

/** The Library in browser-first Cloud. Empty, it is one step: add your music. With songs, the
 * header holds the counts and Connect music, one banner says when songs need choosing again to
 * play here, and the songs follow straight after the toolbar. Adding music reports its progress
 * in the same place, wherever it was started from. */
export function CloudLibrary({ shared, connected, connect }: {
  shared: ViewProps;
  /** how many songs the library lists */
  connected: number;
  connect: ConnectProps;
}) {
  const handle = useRef<ConnectMusicHandle>(null);
  const session = useImportSession(connect.workspaceId);
  const importing = session.phase === 'running';
  const [dismissed, setDismissed] = useState(false);
  // the finished import's result stands in for the banner until it is put away
  const [resultSeen, setResultSeen] = useState<ImportSummary | null>(null);
  const playable = shared.status.counts.ready ?? 0;
  const holder = useContext(HolderContext);
  // ADR-0475 R7: a browser that cannot keep folder access (most phones) says so once, never on
  // every page; the songs are asked for again when they are needed
  const [keepSaid, setKeepSaid] = useState(() => { try { return localStorage.getItem(KEEP_SAID) === '1'; } catch { return true; } });
  const sayKept = () => { setKeepSaid(true); try { localStorage.setItem(KEEP_SAID, '1'); } catch { /* said for this visit */ } };
  const doneWords = (summary: ImportSummary) => {
    if (playable === 0 && summary.imported + summary.duplicates > 0) return summaryWords(summary);
    const failed = summary.failed ? ` ${countOf(summary.failed, 'file')} could not be read.` : '';
    return `${formatCount(playable)} of ${countOf(connected, 'song')} can now play here.${failed}`;
  };
  const connectProps = { ...connect, doneWords, onResultDismissed: setResultSeen };

  if (connected === 0) {
    return (
      <main className="page library library-browser" id="main">
        <header className="page-header">
          <div className="page-header-text">
            <h1 className="display small">Library</h1>
            <p className="page-lead">Your songs, and which of them can play on this device.</p>
          </div>
        </header>
        <ConnectMusic {...connectProps} variant="hero" />
      </main>
    );
  }

  const folders = handle.current?.folders ?? true;
  // none, or so few that the library reads as "not here": this browser has not been given the music
  const fresh = playable === 0 || playable * 5 < connected;
  const showingResult = (session.phase === 'finished' || session.phase === 'paused') && !!session.summary && session.summary !== resultSeen;
  const needsFolder = playable < connected && !importing && !showingResult && (fresh || !dismissed);
  const choose = folders ? 'Choose your music folder' : 'Choose your songs';
  const action = importing
    ? <Status kind="working">Adding music</Status>
    : (
      <Menu className={needsFolder && fresh ? 'lw-connect-menu' : 'lw-connect-menu lw-primary'} label={<><Icon name="plus" size="toolbar" />Connect music</>}>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseFolder()}><Icon name="folder" size="toolbar" />Choose a folder</button>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseSongs()}><Icon name="music" size="toolbar" />Choose songs</button>
      </Menu>
    );
  return (
    <Library {...shared} browser={{ action }} lead={(
      <div className="lw-lead">
        {needsFolder && fresh && holder && (
          // ADR-0475 R6: another device has the music, so this one is its remote; connecting
          // music here is a choice, not the way forward
          <p className="lw-remote-line" data-testid="library-remote-line">
            <Icon name="system" size="toolbar" />
            <span>{playable > 0
              // R7: a device with some music of its own plays those; the rest are on the other device
              ? `${formatCount(playable)} of ${countOf(connected, 'song')} are on this device. The rest are on ${holder.name}${holder.online ? '' : ', which isn’t open right now'}.`
              : `${holder.online ? `This device is a remote for ${holder.name}.` : `Your music is on ${holder.name}, which isn’t open right now.`} Connect music here only if you want this device to make the sound.`}</span>
          </p>
        )}
        {needsFolder && fresh && !holder && (
          <section className="lw-welcome" aria-labelledby="library-give-music">
            <span className="lw-welcome-mark" aria-hidden="true"><Icon name="folder" /></span>
            <div>
              <h2 id="library-give-music">{playable === 0 ? 'This browser hasn’t been given your music yet' : `Only ${formatCount(playable)} of ${countOf(connected, 'song')} can play in this browser`}</h2>
              <p>Each browser needs the folder once. Your library, mixes and settings are already here.</p>
            </div>
            <button type="button" className="primary" onClick={() => handle.current?.chooseFolder()}><Icon name="folder" size="toolbar" />{choose}</button>
          </section>
        )}
        {needsFolder && !fresh && (
          <div className="banner" data-tone="info" role="status">
            <Icon name="folder" size="toolbar" />
            <p><b>{`${formatCount(playable)} of ${countOf(connected, 'song')} can play here.`}</b> Choose your music folder to open the rest.</p>
            <button type="button" onClick={() => handle.current?.chooseFolder()}>{choose}</button>
            <button type="button" className="quiet" onClick={() => setDismissed(true)}>Dismiss</button>
          </div>
        )}
        {!keepSaid && playable > 0 && !dirPicker().supported && (
          <p className="lw-remote-line" data-testid="library-keep-line">
            <Icon name="system" size="toolbar" />
            <span>This browser can’t keep access to your music between visits. When a song is needed again, SelectaDJ asks you to choose it.</span>
            <button type="button" className="quiet" onClick={sayKept}>Got it</button>
          </p>
        )}
        <ConnectMusic {...connectProps} ref={handle} variant="status" />
      </div>
    )} />
  );
}
