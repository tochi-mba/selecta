import { useState } from 'react';
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
