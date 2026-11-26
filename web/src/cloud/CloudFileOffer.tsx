import { useEffect, useId, useRef, useState } from 'react';
import { useRequest } from '../requestContext';
import { below } from '../styles/breakpoints';
import { Action } from '../ui/controls';
import { Meter } from '../ui/Meter';
import { useMediaQuery } from '../ui/useMediaQuery';
import type { ExportElsewhereProps } from '../views/exportElsewhere';
import { useMixPath } from '../views/mixScope';
import type { CloudFileState } from './cloudFileExport';
import { downloadWords, exportWords } from './hosted/hostedWords';

/** "Make the file in your cloud library" in the Export panel (cloud.one_mixer, cloudFileExport.ts):
 * offered only when every song of the mix is in the cloud library, and recommended on a phone,
 * which then needn't read and join the whole mix itself. The file is followed until it is ready,
 * the panel closes, or the time limit passes; then Check again. */

export const CLOUD_FILE = 'Make the file in your cloud library';
const POLL_MS = 6000;
/** Followed at most this long (or twice its estimate, if longer) before the panel stops asking. */
export const FOLLOW_MS = 15 * 60_000;

const settled = (state: CloudFileState | null) => !!state && ['ready', 'failed', 'refused'].includes(state.state);
const said = (problem: unknown) => (problem instanceof Error && problem.message) || 'SelectaDJ couldn’t ask for the file. Try again.';
const pause = (ms: number) => new Promise((done) => window.setTimeout(done, ms));

export function CloudFileOffer({ mix, onFirst }: ExportElsewhereProps) {
  const request = useRequest();
  const at = useMixPath();
  const id = useId();
  const phone = useMediaQuery(below('tablet'));
  const order = mix.map((item) => item.song_id).join(',');
  const [offered, setOffered] = useState(false);
  const [state, setState] = useState<CloudFileState | null>(null);
  const [problem, setProblem] = useState('');
  const [overdue, setOverdue] = useState(false);
  // each follow holds a token: a new press, a changed mix or closing the panel ends the old one
  const following = useRef(0);
  useEffect(() => () => { following.current += 1; }, []);

  useEffect(() => {
    let current = true;
    following.current += 1;
    setState(null);
    setProblem('');
    setOverdue(false);
    request<{ offered?: boolean }>(at('/exports/cloud')).then(
      (answer) => { if (current) setOffered(answer?.offered === true); },
      () => { if (current) setOffered(false); },
    );
    return () => { current = false; };
  }, [request, at, order]);

  const first = offered && phone;
  useEffect(() => { onFirst(first); }, [first, onFirst]);
  useEffect(() => () => onFirst(false), [onFirst]);

  const ask = () => request<CloudFileState>(at('/exports/cloud'), { method: 'POST', headers: { 'x-mix-order': order } });
  const follow = async (token: number, from: CloudFileState) => {
    let now = from;
    const started = Date.now();
    const limit = Math.max(FOLLOW_MS, (now.estimate_s ?? 0) * 2000);
    while (following.current === token && !settled(now)) {
      if (Date.now() - started > limit) { setOverdue(true); return; }
      await pause(POLL_MS);
      if (following.current !== token) return;
      // while its parts are being made, asking again moves them along; then the job is followed
      const job = now.job_id;
      now = now.state === 'preparing' || !job ? await ask() : { ...(await request<CloudFileState>(`/exports/cloud/${encodeURIComponent(job)}`)), job_id: job };
      if (following.current === token) setState(now);
    }
  };
  const start = async (from?: CloudFileState) => {
    setProblem('');
    setOverdue(false);
    const token = (following.current += 1);
    try {
      const answer = from ?? await ask();
      setState(answer);
      void follow(token, answer).catch((seen) => { if (following.current === token) setProblem(said(seen)); });
    } catch (seen) {
      setProblem(said(seen));
      setState(null);
      return false;
    }
  };

  if (!offered && !state) return null;
  const preparing = state?.state === 'preparing' ? state.counts : undefined;
  const line = state && state.state !== 'preparing' ? exportWords(state) : null;
  const download = state?.state === 'ready' && state.url ? downloadWords(state, phone) : null;
  const making = !!state && !settled(state) && !overdue;
  return (
    <section className="export-elsewhere" aria-labelledby={id} data-recommended={first || undefined}>
      <h3 id={id}>{CLOUD_FILE}</h3>
      <p className="hint">
        {first ? 'Recommended on phones. ' : ''}Every song in this mix is in your cloud library, so the file can be made there and this device doesn’t have to. Its transitions are made there too, so they can sound a little different from the ones you hear here.
      </p>
      {preparing && (
        <Meter label="Getting transitions ready" value={preparing.seams_ready + (preparing.seams_failed ?? 0)} max={Math.max(1, preparing.seams)} valueText={`${preparing.seams_ready} of ${preparing.seams} transitions`} />
      )}
      {making && line && <Meter label="Making the file" value={line.fraction ?? undefined} max={1} valueText={line.value} detail={line.detail ?? undefined} />}
      {settled(state) && state?.state !== 'ready' && line?.detail && <p className="warn" role="alert">{line.detail}</p>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {overdue && state && !settled(state) && (
        <p className="hint">This is taking longer than expected. It carries on in your cloud library. <Action className="small" working="Checking…" run={() => start(state)}>Check again</Action></p>
      )}
      {download && state?.url
        // a plain link to the stored file: the browser downloads it itself
        ? <a className="button" href={state.url} download>{download.label}</a>
        : !overdue && <Action className={first ? 'primary' : undefined} disabled={making} busy={making} working="Asking…" run={() => start()}>{settled(state) ? 'Try again' : CLOUD_FILE}</Action>}
      {download?.note && <p className="hint">{download.note}</p>}
    </section>
  );
}
