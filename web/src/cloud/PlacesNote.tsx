import { useState } from 'react';
import { Dialog } from '../ui/controls';
import { Icon } from '../ui/Icon';

/** library.places: the one line at the top of the Library that says songs live in two places,
 * with a short sheet on how, and Got it. Put away, it stays away for that person in this
 * browser; a browser that refuses storage simply shows it again next visit, which is harmless. */

export const PLACES_NOTE_PREFIX = 'selecta.places-note.';
const key = (accountId: string) => `${PLACES_NOTE_PREFIX}${accountId}`;

function wasPutAway(accountId: string): boolean {
  try {
    return localStorage.getItem(key(accountId)) === 'seen';
  } catch {
    return false;
  }
}

export const PLACES_NOTE_WORDS = 'Songs are kept on this device or in your cloud library.';

export function PlacesNote({ accountId }: { accountId: string }) {
  const [hidden, setHidden] = useState(() => wasPutAway(accountId));
  const [explaining, setExplaining] = useState(false);
  if (hidden) return null;
  const gotIt = () => {
    try { localStorage.setItem(key(accountId), 'seen'); } catch { /* shown again next visit */ }
    setHidden(true);
  };
  return (
    <>
      <p className="lw-remote-line lw-places-note" data-testid="library-places-note">
        <Icon name="cloud" size="toolbar" />
        <span>{PLACES_NOTE_WORDS}</span>
        <button type="button" className="quiet" onClick={() => setExplaining(true)}>How it works</button>
        <button type="button" className="quiet" onClick={gotIt}>Got it</button>
      </p>
      {explaining && (
        <Dialog title="Where your songs are kept" onClose={() => setExplaining(false)} footer={<button type="button" className="primary" onClick={() => setExplaining(false)}>Close</button>}>
          <p>Songs you add from a folder, or choose one by one, stay on this device. SelectaDJ plays them from your own files, which are never moved or changed.</p>
          <p>Songs you upload are kept in your cloud library and play on all your devices.</p>
          <p>A song can be in both places. Its details say where it is kept, and the Library’s filters show each place.</p>
        </Dialog>
      )}
    </>
  );
}
