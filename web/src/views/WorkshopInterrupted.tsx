import { useEffect, useState } from 'react';
import type { Request } from '../api';
import { flagOn } from '../flags';
import { useApi } from '../requestContext';
import { Action } from '../ui/controls';
import { ViewProps } from './shared';

/** The scan as /api/status reports it once it carries on after a restart (library.scan_resume). */
type ResumedScan = { status: string; folder?: string; resumed?: { done: number; found: number | null } };

/** What a restart cut off, from GET /api/library/interrupted. */
type Interrupted = {
  lyrics: boolean;
  scan: { folder: string; done: number; found: number | null } | null;
  /** core.durable_local_jobs: work the job host is carrying on by itself, never offered again */
  carrying_on?: { lyrics: boolean; exports: number };
};

const count = (value: number) => value.toLocaleString();

/** Work a restart cut off, each with one next step (library.scan_resume). A scan carries on by
 * itself and says so; a lyric lookup is offered again. Interrupted exports are offered in the
 * Exports list, next to the export itself. With the flag off this shows nothing. */
export function InterruptedWork({ status, request }: { status: ViewProps['status']; request?: Request }) {
  const { get, post } = useApi(request);
  const on = flagOn('library.scan_resume');
  const [interrupted, setInterrupted] = useState<Interrupted | null>(null);
  const scan = status.scan as ResumedScan;
  useEffect(() => {
    if (!on) return;
    let live = true;
    // nothing to say if it can't be asked: this only adds a sentence, it never blocks the page
    get<Interrupted>('/library/interrupted').then((answer) => { if (live) setInterrupted(answer); }).catch(() => {});
    return () => { live = false; };
  }, [on, scan.status]);
  if (!on) return null;
  const resumed = scan.status === 'running' ? scan.resumed : undefined;
  const lyricsAgain = async () => {
    await post('/library/lyrics/again');
    setInterrupted((now) => now && { ...now, lyrics: false });
  };
  const going = interrupted?.carrying_on;
  if (!resumed && !interrupted?.lyrics && !going?.lyrics && !going?.exports) return null;
  return (
    <section className="panel stack" aria-label="Interrupted work">
      {resumed && (
        <p role="status">
          {resumed.found
            ? `A scan was interrupted. Carrying on from ${count(resumed.done)} of ${count(resumed.found)} files.`
            : 'A scan was interrupted. Carrying on where it stopped.'}
          {' '}Songs already read are not read again.
        </p>
      )}
      {!!going?.exports && (
        <p role="status">{going.exports === 1 ? 'Your export is carrying on by itself.' : `${going.exports} exports are carrying on by themselves.`} Nothing needs starting again.</p>
      )}
      {going?.lyrics && <p role="status">Looking up lyrics is carrying on by itself. Nothing needs starting again.</p>}
      {interrupted?.lyrics && (
        <div className="row wrap">
          <p>Looking up lyrics was interrupted. Start it again?</p>
          <Action working="Starting…" run={lyricsAgain}>Start it again</Action>
        </div>
      )}
    </section>
  );
}
