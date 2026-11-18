import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '../api';

/**
 * BF-0467-05: the Labs card for browser-first Cloud. It asks the server where the member stands
 * (`GET /api/account/labs/local-first`) and offers exactly what is true: join while Labs is open,
 * leave whenever they are in (even after Labs closes), and a feedback box while they are in.
 * When Labs is closed and the member is not in, it renders nothing, so the settings page reflows.
 */
export type LabsStatus = { enrolled: boolean; on: boolean; reason: string; labs_open: boolean };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

// Cloud's request function prefixes `/api` itself (CloudApp `api`), so the path starts after it.
const BASE = '/account/labs/local-first';

export function LocalFirstLabs({ request, onChanged }: { request: Request; onChanged?: () => void }) {
  const [status, setStatus] = useState<LabsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    try { setStatus(await request<LabsStatus>(BASE)); } catch { setStatus(null); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const act = async (path: 'join' | 'leave') => {
    setBusy(true); setNote('');
    try {
      await request(`${BASE}/${path}`, { method: 'POST' });
      setNote(path === 'join' ? 'You are in. Browser-first Cloud is on for your account.' : 'You have left. Your account is back to the usual Cloud.');
      onChanged?.();
    } catch (error) {
      setNote(messageOf(error, 'That did not work. Try again in a moment.'));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const send = async () => {
    if (!feedback.trim()) return;
    setBusy(true);
    try {
      await request(`${BASE}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: feedback.trim() }) });
      setFeedback(''); setNote('Thanks. The SelectaDJ team reads every note.');
    } catch (error) {
      setNote(messageOf(error, 'Your note did not send. Try again in a moment.'));
    } finally { setBusy(false); }
  };

  if (!status || (!status.labs_open && !status.enrolled)) return null;
  return (
    <section className="cloud-labs" aria-label="Labs: browser-first Cloud">
      <h2>Labs: browser-first Cloud</h2>
      <p>Your music stays on your own devices and plays in this browser. It is a preview, and you can leave at any time.</p>
      {status.enrolled && !status.on && <p role="status">You are in Labs, but browser-first Cloud is paused for your account right now.</p>}
      {status.enrolled
        ? <button type="button" disabled={busy} onClick={() => void act('leave')}>Leave Labs</button>
        : <button type="button" disabled={busy} onClick={() => void act('join')}>Join Labs</button>}
      {status.enrolled && status.labs_open && (
        <div className="cloud-labs-feedback">
          <label htmlFor="cloud-labs-feedback">Tell us what you noticed</label>
          <textarea id="cloud-labs-feedback" maxLength={2000} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          <button type="button" disabled={busy || !feedback.trim()} onClick={() => void send()}>Send feedback</button>
        </div>
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}
