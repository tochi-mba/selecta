import { PageLink } from '../shell/PageLink';
import { Icon } from '../ui/Icon';
import { Library } from '../views/Library';
import type { ViewProps } from '../views/shared';
import './libraryWorkspace.css';

/** cloud.one_shell: the Library for an account with no music on its devices. The same Library,
 * with one way to add songs, Upload music (the More place at /upload, when the account can
 * upload): no folder to connect, no folder checks and nothing about this device. */
export function CloudOnlyLibrary({ shared, connected, upload }: {
  shared: ViewProps;
  /** how many songs the library lists */
  connected: number;
  /** the address of Upload music, or null when this account cannot upload */
  upload: string | null;
}) {
  const add = upload ? <PageLink to={upload} className="button primary"><Icon name="cloud" size="toolbar" />Upload music</PageLink> : null;
  if (connected === 0) {
    return (
      <main className="page library library-browser" id="main">
        <header className="page-header">
          <div className="page-header-text">
            <h1 className="display small">Library</h1>
            <p className="page-lead">Your songs, kept in your cloud library.</p>
          </div>
        </header>
        <section className="empty-state boxed lw-hero" aria-labelledby="library-upload-first">
          <span className="empty-state-icon" aria-hidden="true"><Icon name="cloud" /></span>
          <h2 id="library-upload-first">{add ? 'Upload your first songs' : 'Your cloud library is empty'}</h2>
          <p>{add ? 'Songs you upload are kept in your cloud library and play on all your devices.' : 'No songs are kept in your cloud library.'}</p>
          {add}
        </section>
      </main>
    );
  }
  return <Library {...shared} browser={{ action: add, cloudOnly: true }} />;
}
