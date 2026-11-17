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

export function CutoverNotice({ accountId }: { accountId: string }) {
  const id = useId();
  const [hidden, setHidden] = useState(() => wasDismissed(accountId));
  if (hidden) return null;
  const dismiss = () => {
    remember(accountId);
    setHidden(true);
  };
  return (
    <section className="cloud-card cloud-cutover" aria-labelledby={`${id}-title`}>
      <div className="cloud-card-heading">
        <div>
          <p className="cloud-eyebrow">A NOTE FROM SELECTADJ</p>
          <h2 id={`${id}-title`}>Nothing has changed for you</h2>
        </div>
        <IconButton icon="close" label="Dismiss this note" onClick={dismiss} />
      </div>
      <p>Your hosted library, your mixes and your plan work exactly as they did. Nothing was moved and nothing was removed.</p>
      <p>New accounts now start with music that stays on their own device: SelectaDJ plays and mixes it right there in the browser, and SelectaDJ Cloud keeps only the details of the library and the mixes.</p>
      <p>If you ever want to work that way too, you can download your originals, add them on your device, and SelectaDJ will match them to your mixes by their contents. It’s entirely up to you, and your hosted library stays where it is either way.</p>
      <div className="cloud-actions">
        <button type="button" className="primary" onClick={dismiss}>Got it</button>
      </div>
    </section>
  );
}
