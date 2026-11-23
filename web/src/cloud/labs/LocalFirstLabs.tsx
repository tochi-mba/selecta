import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { showToast } from '../../ui/toasts';
import { Badge, Notice, SettingsCard } from '../AccountLayout';
import { messageOf } from '../api';

/**
 * BF-0467-05: the Labs card for browser-first Cloud. It asks the server where the member stands
 * (`GET /api/account/labs/local-first`) and offers exactly what is true: join while Labs is open,
 * leave whenever they are in (even after Labs closes), and a feedback box while they are in.
 * When Labs is closed and the member is not in, it renders nothing, so the settings page reflows.
 *
 * Leaving asks first. What went well is a status and what went wrong is an alert, never the same
 * line. Focus stays on the card's main button as it swaps between Join and Leave, and a feedback
 * draft survives a failed send, a reload and a leave-and-rejoin.
 */
export type LabsStatus = { enrolled: boolean; on: boolean; reason: string; labs_open: boolean };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

// Cloud's request function prefixes `/api` itself (CloudApp `api`), so the path starts after it.
const BASE = '/account/labs/local-first';
export const LABS_DRAFT_KEY = 'selecta.labs.feedback-draft';

function readDraft(): string {
  try { return sessionStorage.getItem(LABS_DRAFT_KEY) ?? ''; } catch { return ''; }
}
function keepDraft(text: string) {
  try {
    if (text) sessionStorage.setItem(LABS_DRAFT_KEY, text);
    else sessionStorage.removeItem(LABS_DRAFT_KEY);
  } catch { /* this visit only */ }
}

export function LocalFirstLabs({ request, onChanged }: { request: Request; onChanged?: () => void }) {
  const [status, setStatus] = useState<LabsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [feedback, setFeedbackState] = useState(readDraft);
  const [asking, setAsking] = useState(false);
  const main = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const setFeedback = (text: string) => { setFeedbackState(text); keepDraft(text); };

  const load = useCallback(async () => {
    try { setStatus(await request<LabsStatus>(BASE)); } catch { setStatus(null); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  // Join becomes Leave (and back) once the server answers: the press lands on the new button.
  // With the confirmation open, this waits for it to close, so its own focus return can't win.
  useEffect(() => {
    if (!refocus.current || !status || asking) return;
    refocus.current = false;
    main.current?.focus();
  }, [status, asking]);

  const act = async (path: 'join' | 'leave') => {
    setBusy(true); setNote(''); setProblem('');
    refocus.current = true;
    try {
      await request(`${BASE}/${path}`, { method: 'POST' });
      setNote(path === 'join' ? 'You are in. Browser-first Cloud is on for your account.' : 'You have left. Your account is back to the usual Cloud.');
      showToast(path === 'join' ? 'You joined Labs.' : 'You left Labs.');
      onChanged?.();
    } catch (error) {
      setProblem(messageOf(error, 'That did not work. Try again in a moment.'));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const send = async () => {
    if (!feedback.trim()) return;
    setBusy(true); setNote(''); setProblem('');
    try {
      await request(`${BASE}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: feedback.trim() }) });
      setFeedback(''); setNote('Thanks. The SelectaDJ team reads every note.');
      showToast('Feedback sent. Thank you.');
    } catch (error) {
      // the draft stays exactly as written, so nothing has to be typed again
      setProblem(messageOf(error, 'Your note did not send. Try again in a moment.'));
    } finally { setBusy(false); }
  };

  if (!status || (!status.labs_open && !status.enrolled)) return null;
  return (
    <SettingsCard
      id="cloud-labs"
      className="cloud-labs"
      title="Labs: browser-first Cloud"
      badge={<Badge tone={status.enrolled ? 'accent' : undefined}>{status.enrolled ? 'You are in' : 'Preview'}</Badge>}
      about="Your music stays on your own devices and plays in this browser. It is a preview, and you can leave at any time."
      actions={status.enrolled
        ? <button ref={main} type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setAsking(true); }}>Leave Labs</button>
        : <button ref={main} type="button" className="primary" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) void act('join'); }}>{busy ? 'Joining…' : 'Join Labs'}</button>}
    >
      {status.enrolled && !status.on && <Notice tone="warn">You are in Labs, but browser-first Cloud is paused for your account right now.</Notice>}
      {status.enrolled && status.labs_open && (
        <div className="cloud-labs-feedback">
          <label htmlFor="cloud-labs-feedback">Tell us what you noticed</label>
          <textarea id="cloud-labs-feedback" maxLength={2000} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          <div className="cloud-actions"><button type="button" disabled={busy || !feedback.trim()} onClick={() => void send()}>Send feedback</button></div>
        </div>
      )}
      {note && <Notice tone="ok">{note}</Notice>}
      {problem && <Notice tone="danger" role="alert">{problem}</Notice>}
      {asking && (
        <ConfirmDialog
          title="Leave Labs?"
          body={status.labs_open
            ? 'Your account goes back to the usual Cloud. Your music stays where it is, and you can join again while Labs is open.'
            : 'Your account goes back to the usual Cloud. Your music stays where it is. Labs is closed to new members now, so you could not join again until it reopens.'}
          confirmLabel="Yes, leave Labs"
          cancelLabel="Stay in Labs"
          onConfirm={() => act('leave')}
          onClose={() => setAsking(false)}
        />
      )}
    </SettingsCard>
  );
}
