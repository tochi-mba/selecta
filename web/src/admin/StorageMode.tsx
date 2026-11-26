import { useState } from 'react';
import { AdminError, AdminFetch, bytes, pressKey, when } from './adminApi';
import { Failure, useLoad } from './parts';

type Mode = {
  mode: 'hosted' | 'browser';
  grant: { value: 'on' | 'off' | 'default'; source: string; build_on: boolean; last_change: { author: string; reason: string; at: number } | null };
  plan: string;
  storage: { used_bytes: number; limit_bytes: number };
  warnings: string[];
  version: string;
};

/**
 * One switch for an account's storage mode (doc 07b §7B.4): browser-first, the default, or hosted
 * Cloud storage and rendering (the `cloud.hosted_media` grant, ADR-0456). Careful tier: it runs
 * at once with a reason and offers Undo, and the server refuses a stale view or view mode.
 */
export function StorageMode({ api, userId, canChange, ensureChanges }: { api: AdminFetch; userId: string; canChange: boolean; ensureChanges?: () => Promise<boolean> }) {
  const state = useLoad(() => api<Mode>(`/admin/customers/${userId}/storage-mode`), [api, userId]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; undo: 'hosted' | 'browser' } | null>(null);
  const [readAt] = useState(() => Date.now() / 1000);
  const mode = state.data;

  const change = async (next: 'hosted' | 'browser', why: string, version?: string) => {
    setBusy(true); setError('');
    try {
      const send = () => api<Mode>(`/admin/customers/${userId}/storage-mode`, {
        method: 'PUT', body: JSON.stringify({ mode: next, reason: why, version: version ?? mode?.version, read_at: readAt }),
        headers: { 'Idempotency-Key': pressKey() },
      });
      let result: Mode;
      try { result = await send(); }
      catch (problem) {
        if (problem instanceof AdminError && problem.code === 'view_mode' && ensureChanges && await ensureChanges()) result = await send();
        else throw problem;
      }
      setDone({ text: next === 'hosted' ? 'Cloud library storage and rendering is on for this account.' : 'This account is back to music on its devices. Its stored songs stay playable.', undo: next === 'hosted' ? 'browser' : 'hosted' });
      setReason('');
      await state.reload();
      return result;
    } catch (problem) { setError((problem as Error).message); return null; }
    finally { setBusy(false); }
  };

  return (
    <section className="admin-config" aria-label="Where their music lives" data-tour="storage-mode">
      <h3>Storage and processing</h3>
      <Failure error={state.error || error} />
      {!mode && !state.error && <p className="admin-skeleton" aria-busy="true">Loading where their music lives…</p>}
      {mode && <>
        <p><strong>{mode.mode === 'hosted' ? 'Cloud library: stored and rendered by SelectaDJ' : 'On their devices (the default)'}</strong>{' '}
          <small className="admin-note">from {mode.grant.source}{mode.grant.last_change ? `; flag last changed ${when(mode.grant.last_change.at)}` : ''}</small></p>
        <p className="admin-note">
          {mode.mode === 'hosted'
            ? 'Uploads go to SelectaDJ storage and mixes are rendered on our workers, which costs storage and compute. Turning it off stops new uploads and renders; everything stored stays playable and exportable.'
            : 'Songs stay on the customer’s own devices and mixes play in their browser. A cloud library lets them upload and have mixes rendered by us, at our storage and compute cost.'}
          {' '}Plan: {mode.plan}. Stored: {bytes(mode.storage.used_bytes)} of {bytes(mode.storage.limit_bytes)}.
        </p>
        {mode.warnings.map((warning) => <p key={warning} className="admin-warning" role="note">{warning}</p>)}
        {canChange ? (
          <div className="admin-inline-form">
            <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="Why, for the audit log" /></label>
            <button type="button" className={mode.mode === 'hosted' ? undefined : 'primary'} disabled={busy || !reason.trim()}
              onClick={() => void change(mode.mode === 'hosted' ? 'browser' : 'hosted', reason.trim())}>
              {busy ? 'Working…' : mode.mode === 'hosted' ? 'Turn off the cloud library for this account' : 'Turn on a cloud library for this account'}
            </button>
          </div>
        ) : <p className="admin-note">Changing this needs the Billing, Admin or Owner role.</p>}
        {done && <p role="status" className="admin-result">{done.text}{' '}
          <button type="button" className="quiet" disabled={busy} onClick={() => { const undo = done.undo; setDone(null); void change(undo, 'Undo of the previous change', ''); }}>Undo</button></p>}
      </>}
    </section>
  );
}
