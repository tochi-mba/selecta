import { useContext, useEffect, useRef, useState } from 'react';
import { HolderContext } from '../devices/controller';
import { dirPicker, type ImportSummary } from '../media';
import { Menu, Status } from '../ui/controls';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Library } from '../views/Library';
import type { ViewProps } from '../views/shared';
import { ConnectMusic, summaryWords, type ConnectMusicHandle } from './ConnectMusic';
import { formatCount } from './ImportStatus';
import { useImportShellView } from './importSession';
import { MusicFolders } from './MusicFolders';
import { deviceSongs } from './libraryPlaces';
import { PlacesNote } from './PlacesNote';
import { LibraryPlacesContext } from '../views/LibraryPlaces';
import { foldAway } from '../views/feelPieces';
import './libraryWorkspace.css';

const KEEP_SAID = 'selecta.library.keep-said';

/** ADR-0475 R6, R7: the one quiet line when another device has the music. A device with some
 * music of its own says how much is here and where the rest is. */
export function remoteLineWords(playable: number, connected: number, holder: { name: string; online: boolean }, keptHere = 0, cloud = 0): string {
  // library.places: songs in the cloud library play here too, so the line counts them apart
  if (cloud > 0) return `${countOf(cloud, 'song')} ${cloud === 1 ? 'is' : 'are'} in your cloud library${playable > 0 ? ` and ${formatCount(playable)} on this device` : ''}. The rest are on ${holder.name}${holder.online ? '' : ', which isn’t open right now'}.`;
  // R7: songs chosen here before, which this browser needs chosen again to play
  if (playable === 0 && keptHere > 0) return `${countOf(keptHere, 'song')} on this device ${keptHere === 1 ? 'needs' : 'need'} choosing again to play here. The rest are on ${holder.name}.`;
  if (playable > 0) return `${formatCount(playable)} of ${countOf(connected, 'song')} are on this device. The rest are on ${holder.name}${holder.online ? '' : ', which isn’t open right now'}.`;
  return `${holder.online ? `This device is a remote for ${holder.name}.` : `Your music is on ${holder.name}, which isn’t open right now.`} Connect music here only if you want this device to make the sound.`;
}

/** R7: said once, on a browser that cannot keep folder access between visits. */
export const KEEP_WORDS = 'This browser can’t keep access to your music between visits. When a song is needed again, SelectaDJ asks you to choose it.';

type ConnectProps = Omit<Parameters<typeof ConnectMusic>[0], 'variant' | 'ref'>;

/** The Library in browser-first Cloud. Empty, it is one step: add your music. With songs, the
 * header holds the counts and Connect music, one banner says when songs need choosing again to
 * play here, and the songs follow straight after the toolbar. Adding music reports its progress
 * in the same place, wherever it was started from. */
/** Where this account's songs live, said once at the top of the Library (staging walkthrough
 * item 4): on this device, in Cloud storage, or both, and which button adds to which. */
export function whereWords(cloudStorage: boolean): string | null {
  if (!cloudStorage) return null;
  return 'Your songs live in two places. Songs from your music folder stay on this device: Connect music adds them. Songs you upload are kept in Cloud storage and play on any of your devices: Add music uploads them.';
}

/** Why fewer songs can play here than a moment ago (staging walkthrough item 15): the songs
 * chosen in this browser before whose permission it has forgotten since. */
export function settleWords(playable: number, keptHere: number): string | null {
  const lapsed = keptHere - playable;
  if (lapsed <= 0) return null;
  return `${countOf(lapsed, 'song')} chosen here before ${lapsed === 1 ? 'needs' : 'need'} this browser’s permission again. Browsers forget it between visits, so the count went down after checking.`;
}

export function CloudLibrary({ shared, connected, connect, cloudStorage = false }: {
  shared: ViewProps;
  /** how many songs the library lists */
  connected: number;
  connect: ConnectProps;
  /** this account also keeps songs in Cloud storage (hosted media) */
  cloudStorage?: boolean;
}) {
  const handle = useRef<ConnectMusicHandle>(null);
  // only the phase and the result: the whole Library re-rendered on every file of an import
  const session = useImportShellView(connect.workspaceId, { counts: false });
  const importing = session.phase === 'running';
  const [dismissed, setDismissed] = useState(false);
  // the feel (ADR-0477): the "can play here" banner folds shut when dismissed; at once without motion
  const settleBanner = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    const folding = foldAway(settleBanner.current);
    if (folding) void folding.then(() => setDismissed(true));
    else setDismissed(true);
  };
  // the finished import's result stands in for the banner until it is put away
  const [resultSeen, setResultSeen] = useState<ImportSummary | null>(null);
  // library.places: the "choose your folder" banners count songs kept on devices only, never
  // the ones in the cloud library, which need no folder
  const places = useContext(LibraryPlacesContext);
  const devices = places ? deviceSongs(shared.status) : null;
  const playable = devices ? devices.here : shared.status.counts.ready ?? 0;
  const wanted = devices ? devices.wanted : connected;
  const holder = useContext(HolderContext);
  // ADR-0475 R7: a browser that cannot keep folder access (most phones) says so once, never on
  // every page; the songs are asked for again when they are needed
  const [keepSaid, setKeepSaid] = useState(() => { try { return localStorage.getItem(KEEP_SAID) === '1'; } catch { return true; } });
  // songs this device was given before (this visit or an earlier one), playable here or not
  const [keptHere, setKeptHere] = useState(0);
  const { openStore } = connect;
  useEffect(() => {
    let live = true;
    void openStore().then((opened) => opened.all()).then((songs) => { if (live) setKeptHere(songs.length); }).catch(() => undefined);
    return () => { live = false; };
  }, [openStore, playable]);
  const sayKept = () => { setKeepSaid(true); try { localStorage.setItem(KEEP_SAID, '1'); } catch { /* said for this visit */ } };
  const doneWords = (summary: ImportSummary) => {
    if (playable === 0 && summary.imported + summary.duplicates > 0) return summaryWords(summary);
    const failed = summary.failed ? ` ${countOf(summary.failed, 'file')} could not be read.` : '';
    return `${formatCount(playable)} of ${countOf(wanted, 'song')} can now play here.${failed}`;
  };
  const connectProps = { ...connect, doneWords, onResultDismissed: setResultSeen };

  if (connected === 0) {
    return (
      <main className="page library library-browser" id="main">
        <header className="page-header">
          <div className="page-header-text">
            <h1 className="display small">Library</h1>
            <p className="page-lead">{places ? 'Your songs, and where each one is kept.' : 'Your songs, and which of them can play on this device.'}</p>
          </div>
        </header>
        {/* library.places: an account that can upload chooses where its first songs are kept */}
        {places?.canUpload ? (
          <div className="lw-add-choices">
            <ConnectMusic {...connectProps} variant="hero" />
            <section className="empty-state boxed lw-hero lw-upload-choice" aria-labelledby="library-upload-choice">
              <span className="empty-state-icon" aria-hidden="true"><Icon name="cloud" /></span>
              <h2 id="library-upload-choice">Upload to your cloud library</h2>
              <p>Songs you upload are kept in your cloud library and play on all your devices.</p>
              <button type="button" className="primary" onClick={places.upload}><Icon name="cloud" size="toolbar" />Upload songs</button>
            </section>
          </div>
        ) : <ConnectMusic {...connectProps} variant="hero" />}
      </main>
    );
  }

  const folders = handle.current?.folders ?? true;
  // none, or so few that the library reads as "not here": this browser has not been given the music
  const fresh = playable === 0 || playable * 5 < wanted;
  const showingResult = (session.phase === 'finished' || session.phase === 'paused') && !!session.summary && session.summary !== resultSeen;
  const needsFolder = playable < wanted && !importing && !showingResult && (fresh || !dismissed);
  const choose = folders ? 'Choose your music folder' : 'Choose your songs';
  // library.places: "Add music" says where each way keeps the songs, and offers uploading
  const action = importing
    ? <Status kind="working">Adding music</Status>
    : (
      // on a remote, connecting music here is a choice, not what the page is for: a quiet action
      <Menu className={(needsFolder && fresh) || holder ? 'lw-connect-menu' : 'lw-connect-menu lw-primary'} label={<><Icon name="plus" size="toolbar" />{places ? 'Add music' : 'Connect music'}</>}>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseFolder()}><Icon name="folder" size="toolbar" />{places ? 'Choose a folder (stays on this device)' : 'Choose a folder'}</button>
        <button type="button" role="menuitem" onClick={() => handle.current?.chooseSongs()}><Icon name="music" size="toolbar" />{places ? 'Choose songs (stays on this device)' : 'Choose songs'}</button>
        {places?.canUpload && <button type="button" role="menuitem" onClick={places.upload}><Icon name="cloud" size="toolbar" />Upload to your cloud library</button>}
      </Menu>
    );
  return (
    <Library {...shared} browser={{ action }} lead={(
      <div className="lw-lead">
        {places ? <PlacesNote accountId={places.accountId} />
          : whereWords(cloudStorage) && <p className="lw-remote-line" data-testid="library-where-line"><Icon name="music" size="toolbar" /><span>{whereWords(cloudStorage)}</span></p>}
        {needsFolder && fresh && holder && (
          // ADR-0475 R6: another device has the music, so this one is its remote; connecting
          // music here is a choice, not the way forward
          <p className="lw-remote-line" data-testid="library-remote-line" data-remote-only={playable === 0 && keptHere === 0 ? '' : undefined}>
            <Icon name="system" size="toolbar" />
            <span>{remoteLineWords(playable, wanted, holder, keptHere, shared.status.places?.cloud ?? 0)}</span>
            {playable === 0 && keptHere > 0 && <button type="button" className="quiet" onClick={() => handle.current?.chooseSongs()}>Choose them again</button>}
          </p>
        )}
        {needsFolder && fresh && !holder && (
          <section className="lw-welcome" aria-labelledby="library-give-music">
            <span className="lw-welcome-mark" aria-hidden="true"><Icon name="folder" /></span>
            <div>
              <h2 id="library-give-music">{playable === 0 ? 'This browser hasn’t been given your music yet' : `Only ${formatCount(playable)} of ${countOf(wanted, 'song')} can play in this browser`}</h2>
              <p>Each browser needs the folder once. Your library, mixes and settings are already here.</p>
            </div>
            <button type="button" className="primary" onClick={() => handle.current?.chooseFolder()}><Icon name="folder" size="toolbar" />{choose}</button>
          </section>
        )}
        {needsFolder && !fresh && (
          <div className="banner" data-tone="info" role="status" ref={settleBanner}>
            <Icon name="folder" size="toolbar" />
            <p><b>{`${formatCount(playable)} of ${countOf(wanted, 'song')} can play here.`}</b> {settleWords(playable, keptHere) ?? ''} Choose your music folder to open the rest.</p>
            <button type="button" onClick={() => handle.current?.chooseFolder()}>{choose}</button>
            <button type="button" className="quiet" onClick={dismiss}>Dismiss</button>
          </div>
        )}
        {!keepSaid && (playable > 0 || keptHere > 0) && !dirPicker().supported && (
          <p className="lw-remote-line" data-testid="library-keep-line">
            <Icon name="system" size="toolbar" />
            <span>{KEEP_WORDS}</span>
            <button type="button" className="quiet" onClick={sayKept}>Got it</button>
          </p>
        )}
        <ConnectMusic {...connectProps} ref={handle} variant="status" />
        {/* cloud.music_folders: the folders this browser watches, folded away unless one needs you */}
        <MusicFolders workspaceId={connect.workspaceId} variant="compact" onAddFolder={() => handle.current?.chooseFolder()} onChooseSongs={() => handle.current?.chooseSongs()} />
      </div>
    )} />
  );
}
