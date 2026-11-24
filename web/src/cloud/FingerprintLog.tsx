import { useSyncExternalStore } from 'react';
import { fingerprintRun, fingerprintVersion, lineWords, subscribeFingerprints, totalsWords } from '../media/fingerprintLog';

// The fingerprint log on "What this browser keeps" (Settings, `cloud.local_media` with
// `cloud.content_cache`): a developer view of the latest import in this tab, file by file, with
// what was computed and what this browser already knew. It shows only the signed-in account's
// own run, named from its own files; another account's import is never listed here.

/** Lines shown at once: the newest, so a 3,000-file import stays light to draw. */
const SHOWN = 300;

export function FingerprintLog({ workspaceId }: { workspaceId: string }) {
  useSyncExternalStore(subscribeFingerprints, fingerprintVersion, fingerprintVersion);
  const run = fingerprintRun(workspaceId);
  const lines = run ? run.lines.slice(-SHOWN) : [];
  const text = lines.map(lineWords).reverse().join('\n');
  return (
    <details className="lw-group diagnostic-raw" id="cloud-fingerprint-log">
      <summary><span className="lw-group-title">Fingerprint log (for developers)</span></summary>
      <p className="hint">
        How the latest import in this tab used what this browser already knew. A song recognised here was fingerprinted before, by this account or another one signed in on this browser, so its file did not have to be read in full. Titles always come from your own files. To follow it in the browser console as well, set <code>localStorage[&apos;selecta.debug.fingerprint&apos;] = &apos;1&apos;</code>.
      </p>
      {run ? (
        <>
          <p role="status">{run.totals.finishedAt ? 'Finished: ' : 'Importing: '}{totalsWords(run.totals)}</p>
          <pre className="diagnostics" tabIndex={0} aria-label="Files, newest first">{text || 'No files yet.'}</pre>
        </>
      ) : <p>No import has run in this tab yet. Connect your music, and each file appears here as it is checked.</p>}
    </details>
  );
}
