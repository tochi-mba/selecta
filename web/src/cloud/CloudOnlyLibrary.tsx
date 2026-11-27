import { useState, type ReactNode } from 'react';
import { PageLink } from '../shell/PageLink';
import { Icon } from '../ui/Icon';
import { Library } from '../views/Library';
import type { ViewProps } from '../views/shared';
import './libraryWorkspace.css';

/** The shared Library with an uploader when the workspace uses Cloud storage. */
export function CloudOnlyLibrary({ shared, connected, upload, uploadPanel, storageMigration }: {
  shared: ViewProps;
  connected: number;
  upload: string | null;
  uploadPanel?: ReactNode;
  storageMigration?: ReactNode;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [hasOpenedUploader, setHasOpenedUploader] = useState(false);
  const add = uploadPanel ? (
    <button type="button" className="button primary" aria-expanded={connectOpen} aria-controls="library-connect-music" onClick={() => {
      setHasOpenedUploader(true);
      setConnectOpen((open) => !open);
    }}>
      <Icon name="cloud" size="toolbar" />Connect music
    </button>
  ) : upload ? <PageLink to={upload} className="button primary"><Icon name="cloud" size="toolbar" />Connect music</PageLink> : null;
  const lead = (
    <>
      {uploadPanel && <section id="library-connect-music" aria-label="Connect music" hidden={!connectOpen}>
        {hasOpenedUploader && uploadPanel}
      </section>}
      {storageMigration}
      {connected === 0 && !connectOpen && (
        <section className="empty-state boxed lw-hero" aria-labelledby="library-upload-first">
          <span className="empty-state-icon" aria-hidden="true"><Icon name="cloud" /></span>
          <h2 id="library-upload-first">{add ? 'Connect your first songs' : 'Your cloud library is empty'}</h2>
          <p>{add ? 'Songs you connect here are uploaded to your cloud library and play on all your devices.' : 'Your cloud library has no songs to play yet.'}</p>
        </section>
      )}
    </>
  );
  return <Library {...shared} browser={{ action: add, cloudOnly: true }} lead={lead} />;
}
