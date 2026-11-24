import { useId, useState } from 'react';
import { Action, Dialog } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ELLIPSIS } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import { showToast } from '../ui/toasts';
import { Notice, SettingsCard, SettingsRow } from './AccountLayout';
import { apiOrigin, bytes, CloudError, messageOf } from './api';
import { useNeedsConnection } from './connection';
import { SUPPORT_EMAIL } from '../support';

// Download my data (docs/saas/11-ui-ux.md §11.1, ADR-0412): one ZIP with the original files,
// settings.json and mixes.json. It is a download, so it keeps working while the account is over
// quota or suspended.

export const EXPORT_FILE = 'selectadj-account-export.zip';

/** How far a download has got: bytes so far, and the whole size when the server says it. */
export type ExportProgress = { received: number; total: number | null };

async function readAll(response: Response, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
  const reader = onProgress && response.body?.getReader ? response.body.getReader() : null;
  if (!reader) return response.blob();
  const size = Number(response.headers?.get('Content-Length'));
  const total = Number.isFinite(size) && size > 0 ? size : null;
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress?.({ received, total });
  }
  return new Blob(parts, { type: response.headers?.get('Content-Type') ?? 'application/zip' });
}

export async function downloadExport(token: string, workspaceId: string, fetchImpl: typeof fetch = fetch, onProgress?: (progress: ExportProgress) => void) {
  const response = await fetchImpl(`${apiOrigin}/api/account/export`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspaceId },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new CloudError(messageOf(payload, `Export failed (${response.status}).`), response.status);
  }
  const blob = await readAll(response, onProgress);
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

export function AccountData({ token, workspaceId, features, withAudio = true }: { token: () => Promise<string>; workspaceId: string; features?: Record<string, boolean>; withAudio?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [problem, setProblem] = useState('');
  // cloud.offline_shell: the export is made by the server, so it waits for the connection
  const offline = useNeedsConnection();
  const start = async () => {
    if (busy) return;
    setBusy(true); setProblem(''); setDone(null); setProgress(null);
    try {
      const size = await downloadExport(await token(), workspaceId, fetch, setProgress);
      setDone(size);
      showToast('Your export has downloaded.');
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); setProgress(null); }
  };
  const label = !busy ? 'Download my data' : progress ? `Downloading${ELLIPSIS}` : `Preparing${ELLIPSIS}`;
  const progressWords = progress ? (progress.total ? `${bytes(progress.received)} of ${bytes(progress.total)}` : `${bytes(progress.received)} so far`) : 'Putting your file together';
  return (
    <SettingsCard
      id="cloud-data"
      title="Download a copy"
      about="Everything SelectaDJ keeps for your account, in one ZIP file."
      busy={busy}
      actions={<button type="button" disabled={!!offline} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void start()}>{!busy && <Icon name="download" size="toolbar" />}{label}</button>}
    >
      <ul className="acct-includes" aria-label="What is in the file">
        {withAudio && <li><Icon name="check" size="compact" /><span><b>Your original audio</b>, exactly as you added it.</span></li>}
        <li><Icon name="check" size="compact" /><span><b>Your settings</b> ({settingsWords(features)}), as settings.json.</span></li>
        <li><Icon name="check" size="compact" /><span><b>Your mixes</b>, as mixes.json: what SelectaDJ Cloud keeps about each one.</span></li>
        {!withAudio && <li data-kept="no"><Icon name="minus" size="compact" /><span><b>Not your music files.</b> They stay on your own devices, so they are not in it.</span></li>}
      </ul>
      {busy && <div className="acct-progress"><Meter label="Your export" value={progress?.total ? progress.received : undefined} max={progress?.total ?? 100} valueText={progressWords} /></div>}
      {offline && <p className="needs-connection">{offline}</p>}
      {done !== null && !busy && <Notice tone="ok">{`Your export has downloaded (${bytes(done)}). Look for ${EXPORT_FILE} in your downloads.`}</Notice>}
      {problem && <Notice tone="danger" role="alert" action={<button type="button" className="small" onClick={() => void start()}>Try again</button>}><strong>The export did not download</strong><span>{problem}</span></Notice>}
    </SettingsCard>
  );
}

// Leaving and deleting (ADR-0420, AV-0420-04). With `cloud.account_states` on, "Sign out
// everywhere" and "Delete account" leave the always-visible rail and live here, at the foot of
// Settings, below the routine choices and set apart from them. Neither is a primary button, and
// each asks once more in a dialog that names what will happen, with the safe choice focused.

type Confirming = 'everywhere' | 'delete' | null;

export function AccountDanger({ busy, onSignOutEverywhere, onDelete }: {
  busy: boolean;
  onSignOutEverywhere: () => Promise<unknown> | void;
  onDelete: () => Promise<unknown> | void;
}) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const offline = useNeedsConnection();
  const deleteBody = useId();
  const close = () => setConfirming(null);
  return (
    <SettingsCard id="cloud-danger" tone="danger" title="Leave or delete" about="These end your sign-ins or remove your account. Each one asks you to confirm first.">
      {offline && <p className="needs-connection">{offline}</p>}
      <div className="acct-rows">
        <SettingsRow title="Sign out everywhere" about="Ends every sign-in, on every device and browser, including this one.">
          <Action type="button" disabled={!!offline} busy={busy || confirming === 'everywhere'} aria-haspopup="dialog" run={() => setConfirming('everywhere')}><Icon name="signout" size="toolbar" />Sign out everywhere</Action>
        </SettingsRow>
        <SettingsRow title="Delete account" about="Signs you out at once and hides your account. It is erased for good after 30 days.">
          <Action type="button" className="destructive" disabled={!!offline} busy={busy || confirming === 'delete'} aria-haspopup="dialog" run={() => setConfirming('delete')}><Icon name="trash" size="toolbar" />Delete account</Action>
        </SettingsRow>
      </div>
      {confirming === 'everywhere' && (
        <ConfirmDialog
          title="Sign out everywhere?"
          body="Every device and browser is signed out, including this one, and any music playing stops. You will need to sign in again on each."
          confirmLabel="Sign out everywhere"
          cancelLabel="Stay signed in"
          working={`Signing out${ELLIPSIS}`}
          onConfirm={() => onSignOutEverywhere()}
          onClose={close}
        />
      )}
      {confirming === 'delete' && (
        <Dialog
          title="Delete your SelectaDJ account?"
          onClose={close}
          className="confirm-dialog"
          role={'alertdialog' as const}
          describedBy={deleteBody}
          footer={(
            <>
              <button type="button" onClick={close} data-autofocus>Keep my account</button>
              <Action type="button" className="destructive" working={`Deleting${ELLIPSIS}`} run={async () => { await onDelete(); close(); }}>Delete my account</Action>
            </>
          )}
        >
          <div id={deleteBody} className="confirm-dialog-body">
            <p>You are signed out on every device straight away, and your account, mixes and settings are hidden.</p>
            <p>After 30 days they are erased for good. Until then, SelectaDJ support at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> can bring your account back.</p>
            <p>A paid plan is cancelled straight away, with no refund for the rest of the period, and does not come back if the account is restored.</p>
            <p className="hint">Want a copy first? Keep your account, then use Download my data.</p>
          </div>
        </Dialog>
      )}
    </SettingsCard>
  );
}
