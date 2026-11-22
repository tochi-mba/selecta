import { useEffect, useState } from 'react';
import { useFlag } from '../flags';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { userLocale } from '../ui/format';
import { allowAndCarryOn, retryImportNow, useResumeOffer, type ResumeOffer } from './importResume';
import { cancelImportSession, type ImportSnapshot } from './importSession';

// The words and small controls every import surface shares (flag `cloud.resilient_import`):
// Connect music, the shell's import chip and onboarding say the same thing the same way, with
// real counts and never a raw browser error.

export function formatCount(count: number): string {
  try {
    return new Intl.NumberFormat(userLocale()).format(count);
  } catch {
    return String(count);
  }
}

/** Files checked so far: read and recorded on this device (or failed to read). */
export function checkedOf(live: ImportSnapshot): number {
  return live.checked ?? live.registered + live.failures.length;
}

/** "412 of 1,280 checked", or "412 checked" while the folder is still being counted. */
export function checkedWords(live: ImportSnapshot): string {
  const checked = formatCount(checkedOf(live));
  return typeof live.total === 'number' ? `${checked} of ${formatCount(live.total)} checked` : `${checked} checked`;
}

/** Seconds until `at`, refreshed each second while `at` is set. */
function useSecondsUntil(at: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/** One line on how a running import stands, for any surface. */
export function progressWords(live: ImportSnapshot, secondsLeft: number | null = null): string {
  const counts = checkedWords(live);
  if (live.elsewhere) return `Another tab is importing. Progress shows here too: ${counts}.`;
  const wait = live.waiting;
  if (wait?.why === 'offline') return `Offline. ${counts}. Carries on when you’re back online.`;
  if (wait?.why === 'signin') return `Sign in again to carry on. Your import is kept. ${counts}.`;
  if (wait?.why === 'server') {
    return secondsLeft !== null && secondsLeft > 0
      ? `SelectaDJ’s service isn’t answering. Trying again in ${secondsLeft} s. ${counts}.`
      : `SelectaDJ’s service isn’t answering. Trying again now. ${counts}.`;
  }
  if ((live.resumed ?? 0) > 0) return `Carrying on your import: ${counts}.`;
  return `Checking your music: ${counts}.`;
}

/** The running import's status line with its one next step ("Try now" while the service is not
 * answering). The line is a polite status region: it changes on waits, not on each file. */
export function ImportProgressLine({ live, className }: { live: ImportSnapshot; className?: string }) {
  const seconds = useSecondsUntil(live.waiting?.why === 'server' ? live.waiting.retryAt : null);
  const waiting = live.waiting && !live.elsewhere ? live.waiting : null;
  return (
    <div className={className ?? 'row wrap'}>
      <p role={waiting ? 'status' : undefined}>{progressWords(live, seconds)}</p>
      {waiting?.why === 'server' && <button type="button" className="quiet" onClick={retryImportNow}>Try now</button>}
    </div>
  );
}

/** What an interrupted import's offer says, with real counts where they were kept. */
export function offerWords(given: ResumeOffer): string {
  const checked = given.marker.checked ?? given.marker.registered;
  const counts = typeof given.marker.total === 'number'
    ? `${formatCount(checked)} of ${formatCount(given.marker.total)} checked`
    : `${formatCount(checked)} checked`;
  if (given.kind === 'allow') return `Your import of ${given.folder} stopped part way: ${counts}. The browser needs your permission again before SelectaDJ can carry on.`;
  return `Your import stopped part way: ${counts}. This browser can’t reopen picked files after a reload, so choose the same ${given.folder ? `folder (${given.folder})` : 'files'} again. SelectaDJ skips everything already done.`;
}

/** The interrupted-import offer: one Allow button when a folder's permission lapsed, an honest
 * re-pick for picked files. Renders nothing when there is nothing to carry on. */
export function ResumeOfferNotice({ workspaceId, onChoose, onForget }: { workspaceId: string; onChoose?: () => void; onForget?: () => void }) {
  const given = useResumeOffer(workspaceId);
  const [refused, setRefused] = useState(false);
  const resilient = useFlag('cloud.resilient_import');
  if (!resilient || !given) return null;
  return (
    <div className="stack" role="note">
      <p>{offerWords(given)}</p>
      {refused && <p role="alert">The browser did not allow it. Press Allow again, or choose the folder again.</p>}
      <div className="row wrap">
        {given.kind === 'allow'
          ? <button type="button" className="primary" onClick={() => { void allowAndCarryOn(given).then((ok) => setRefused(!ok)); }}>{`Allow access to ${given.folder} to carry on`}</button>
          : onChoose && <button type="button" className="primary" onClick={onChoose}>Choose them again</button>}
        {onForget && <button type="button" className="quiet" onClick={onForget}>Forget this</button>}
      </div>
    </div>
  );
}

/** Cancel, which with `cloud.resilient_import` asks first: it is the one press that throws away
 * an import's progress. */
export function CancelImportButton({ label = 'Cancel', className }: { label?: string; className?: string }) {
  const resilient = useFlag('cloud.resilient_import');
  const [asking, setAsking] = useState(false);
  if (!resilient) return <button type="button" className={className} onClick={cancelImportSession}>{label}</button>;
  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)}>{label}</button>
      {asking && (
        <ConfirmDialog
          title="Stop this import?"
          body="Songs already added stay in your library. The files not yet added would need checking again next time."
          confirmLabel="Stop the import"
          cancelLabel="Keep importing"
          onConfirm={() => { cancelImportSession(); }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}
