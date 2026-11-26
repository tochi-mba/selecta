import { useId, useState } from 'react';
import { IconButton } from '../../ui/primitives';

/** The one cutover notice for grandfathered hosted accounts (ADR-0465 BF-0465-04).
 *
 * Calm on purpose: nothing changed for them, what the new default means, and the voluntary path if
 * they ever want it. No countdown, no deprecation words, no pressure. Once dismissed it never comes
 * back on this browser; the record is kept per account in localStorage, inside try/catch, and a
 * browser that refuses storage simply shows it again next visit, which is harmless. */

export const CUTOVER_NOTICE_PREFIX = 'selecta.cutover-notice.';
const key = (accountId: string) => `${CUTOVER_NOTICE_PREFIX}${accountId}`;

function wasDismissed(accountId: string): boolean {
  try {
    return localStorage.getItem(key(accountId)) === 'dismissed';
  } catch {
    return false;
  }
}

function remember(accountId: string) {
  try {
    localStorage.setItem(key(accountId), 'dismissed');
  } catch {
    // shown again next visit; nothing else depends on it
  }
}

/** Which note this account gets, decided once and kept: an account that already held hosted
 * music is grandfathered ("Nothing has changed"); one granted Cloud storage with nothing stored
 * yet is new to it ("Cloud storage is on"). Kept so an upload never swaps the note it was shown. */
function noteKind(accountId: string, storedBytes: number): 'grandfathered' | 'granted' {
  const kindKey = `${key(accountId)}.kind`;
  try {
    const kept = localStorage.getItem(kindKey);
    if (kept === 'grandfathered' || kept === 'granted') return kept;
    const decided = storedBytes > 0 ? 'grandfathered' : 'granted';
    localStorage.setItem(kindKey, decided);
    return decided;
  } catch {
    return storedBytes > 0 ? 'grandfathered' : 'granted';
  }
}

export function CutoverNotice({ accountId, storedBytes = 1 }: { accountId: string; storedBytes?: number }) {
  const id = useId();
  const [hidden, setHidden] = useState(() => wasDismissed(accountId));
  const [kind] = useState(() => noteKind(accountId, storedBytes));
  if (hidden) return null;
  const dismiss = () => {
    remember(accountId);
    setHidden(true);
  };
  if (kind === 'granted') return (
    <section className="cloud-card cloud-cutover" aria-labelledby={`${id}-title`}>
      <div className="cloud-card-heading">
        <div>
          <p className="cloud-eyebrow">A note from SelectaDJ</p>
          <h2 id={`${id}-title`}>Cloud storage is on for your account</h2>
        </div>
        <IconButton icon="close" label="Dismiss this note" onClick={dismiss} />
      </div>
      <p>Upload songs in Add music. They are stored privately for your account and play on any of your devices.</p>
      <p>The songs in your music folder stay on this device, as before. Your Library shows both, and says which is which.</p>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={dismiss}>Got it</button>
      </div>
    </section>
  );
  return (
    <section className="cloud-card cloud-cutover" aria-labelledby={`${id}-title`}>
      <div className="cloud-card-heading">
        <div>
          <p className="cloud-eyebrow">A note from SelectaDJ</p>
          <h2 id={`${id}-title`}>Nothing has changed for you</h2>
        </div>
        <IconButton icon="close" label="Dismiss this note" onClick={dismiss} />
      </div>
      <p>Your cloud library, your mixes and your plan work exactly as they did. Nothing was moved and nothing was removed.</p>
      <p>New accounts now start with music that stays on their own device: SelectaDJ plays and mixes it right there in the browser, and SelectaDJ Cloud keeps only the details of the library and the mixes.</p>
      <p>If you ever want to work that way too, you can download your originals, add them on your device, and SelectaDJ will match them to your mixes by their contents. It’s entirely up to you, and your cloud library stays where it is either way.</p>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={dismiss}>Got it</button>
      </div>
    </section>
  );
}
