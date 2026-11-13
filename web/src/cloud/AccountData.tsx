import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { apiOrigin, CloudError, messageOf } from './api';

// Download my data (docs/saas/11-ui-ux.md §11.1, ADR-0412): one ZIP with the original files,
// settings.json and mixes.json. It is a download, so it keeps working while the account is over
// quota or suspended.

export const EXPORT_FILE = 'selectadj-account-export.zip';

export async function downloadExport(token: string, workspaceId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${apiOrigin}/api/account/export`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspaceId },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new CloudError(messageOf(payload, `Export failed (${response.status}).`), response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = EXPORT_FILE;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return blob.size;
}

/** The settings the export names: only features this account has on (a feature that's off isn't
 * mentioned anywhere, ADR-0390), though whatever was saved before is still in the file. */
export function settingsWords(features: Record<string, boolean> = {}) {
  const parts = ['account', 'plan', ...(features.lucy !== false ? ['Lucy choices'] : []), ...(features.devices !== false ? ['devices'] : [])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

export function AccountData({ token, workspaceId, features }: { token: () => Promise<string>; workspaceId: string; features?: Record<string, boolean> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const start = async () => {
    setBusy(true); setProblem(''); setNotice('Preparing your export…');
    try {
      await downloadExport(await token(), workspaceId);
      setNotice('Your export has downloaded. It holds your original files, settings.json and mixes.json.');
    } catch (error) { setProblem((error as Error).message); setNotice(''); }
    finally { setBusy(false); }
  };
  return (
    <section className="cloud-card" aria-labelledby="cloud-data-title">
      <p className="cloud-eyebrow">YOUR DATA</p>
      <h2 id="cloud-data-title">Download a copy</h2>
      <p>One ZIP file with your original audio, your settings ({settingsWords(features)}) as settings.json, and what Cloud keeps about your mixes as mixes.json. Mix revisions themselves aren’t stored in Cloud yet.</p>
      <button className="primary" disabled={busy} onClick={() => void start()} aria-busy={busy || undefined}>{busy ? 'Preparing export…' : 'Download my data'}</button>
      {notice && <p role="status">{notice}</p>}
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
    </section>
  );
}

// Leaving and deleting (ADR-0420, AV-0420-04). With `cloud.account_states` on, "Sign out
// everywhere" and "Delete account" leave the always-visible rail and live here, at the foot of
// Settings, below the routine choices. Neither is a primary button, and each asks once more in
// the page, with the safe choice focused and Escape backing out.

type Confirming = 'everywhere' | 'delete' | null;

export function AccountDanger({ busy, onSignOutEverywhere, onDelete }: {
  busy: boolean;
  onSignOutEverywhere: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const everywhere = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const last = useRef<Confirming>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
    else if (last.current) (last.current === 'delete' ? remove : everywhere).current?.focus();
    last.current = confirming ?? last.current;
  }, [confirming]);
  const back = () => setConfirming(null);
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); back(); } };
  return (
    <section className="cloud-card cloud-danger" aria-labelledby="cloud-danger-title">
      <p className="cloud-eyebrow">LEAVING OR DELETING</p>
      <h2 id="cloud-danger-title">Sign-in and account removal</h2>
      <div className="cloud-danger-row">
        <div><h3>Sign out everywhere</h3><p>Ends every sign-in, on every device and browser, including this one.</p></div>
        <button ref={everywhere} className="cloud-quiet" disabled={busy} aria-expanded={confirming === 'everywhere'} onClick={() => setConfirming('everywhere')}>Sign out everywhere…</button>
      </div>
      {confirming === 'everywhere' && (
        <div className="cloud-confirm" role="group" aria-label="Confirm signing out everywhere" onKeyDown={escape}>
          <p>Every device will need to sign in again. Music playing on another device stops.</p>
          <div className="cloud-actions"><button ref={keep} onClick={back}>Stay signed in</button><button className="cloud-danger-action" disabled={busy} onClick={() => { back(); onSignOutEverywhere(); }}>Sign out everywhere</button></div>
        </div>
      )}
      <div className="cloud-danger-row">
        <div><h3>Delete account</h3><p>Hides your account and signs you out at once. Final erasure happens after a 30-day recovery window.</p></div>
        <button ref={remove} className="cloud-quiet cloud-danger-text" disabled={busy} aria-expanded={confirming === 'delete'} onClick={() => setConfirming('delete')}>Delete account…</button>
      </div>
      {confirming === 'delete' && (
        <div className="cloud-confirm" role="group" aria-label="Confirm deleting your account" onKeyDown={escape}>
          <p>Delete your SelectaDJ Cloud account? You will be signed out immediately. Download your data first if you want a copy. Contact SelectaDJ support within 30 days to keep it.</p>
          <div className="cloud-actions"><button ref={keep} onClick={back}>Keep my account</button><button className="cloud-danger-action" disabled={busy} onClick={() => { back(); onDelete(); }}>Delete my account</button></div>
        </div>
      )}
    </section>
  );
}
