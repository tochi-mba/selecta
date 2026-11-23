import { useRef, useState } from 'react';
import { Menu, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Library } from '../views/Library';
import type { ViewProps } from '../views/shared';
import { ConnectMusic, type ConnectMusicHandle } from './ConnectMusic';
import { formatCount } from './ImportStatus';
import { useImportSession } from './importSession';
import './libraryWorkspace.css';

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
  const importing = useImportSession(connect.workspaceId).phase === 'running';
  const [dismissed, setDismissed] = useState(false);
  const playable = shared.status.counts.ready ?? 0;

  if (connected === 0) {
    return (
      <main className="page library library-browser" id="main">
        <header className="page-header">
          <div className="page-header-text">
            <h1 className="display small">Library</h1>
            <p className="page-lead">Your songs, and which of them can play on this device.</p>
          </div>
        </header>
        <ConnectMusic {...connect} variant="hero" />
      </main>
    );
  }

  const folders = handle.current?.folders ?? true;
  const none = playable === 0;
  const action = importing
    ? <Status kind="working">Adding music</Status>
    : (
      <Menu className={none ? 'lw-connect-menu' : 'lw-connect-menu lw-primary'} label={<><Icon name="plus" size="toolbar" />Connect music</>}>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseFolder()}><Icon name="folder" size="toolbar" />Choose a folder</button>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseSongs()}><Icon name="music" size="toolbar" />Choose songs</button>
      </Menu>
    );
  const needsChoosing = playable < connected && !importing && (none || !dismissed);
  return (
    <Library {...shared} browser={{ action }} lead={(
      <div className="lw-lead">
        {needsChoosing && (
          <div className="banner" data-tone={none ? 'warn' : 'info'} role="status">
            <Icon name="folder" size="toolbar" />
            <p>
              <b>{none ? 'Your songs are not open in this browser yet.' : `${formatCount(playable)} of ${formatCount(connected)} songs can play here.`}</b>{' '}
              {none ? 'Choose your folder again to play them.' : 'Choose your folder again to open the rest.'}
            </p>
            <button type="button" className={none ? 'primary' : undefined} onClick={() => handle.current?.chooseFolder()}>{folders ? 'Choose your folder again' : 'Choose your songs again'}</button>
            {!none && <button type="button" className="quiet" onClick={() => setDismissed(true)}>Dismiss</button>}
          </div>
        )}
        <ConnectMusic {...connect} ref={handle} variant="status" />
      </div>
    )} />
  );
}
