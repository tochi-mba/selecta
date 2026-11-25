import { useEffect, useState } from 'react';
import { Action } from '../ui/controls';
import { countOf, Truncate } from '../ui/format';
import type { Api } from './api';
import type { UploadSession } from './uploadParts';

// Unfinished uploads (staging walkthrough, item 2). Two kinds read differently:
// - "planned": SelectaDJ never started storing it, which is on our side (storage refused or was
//   down). Say so, offer Remove, and look again by itself every half minute: once storage takes
//   it, the person is told to choose the file again to finish (the file itself stays on their
//   device; the page cannot read it again on its own after the visit).
// - "uploading": the browser stopped part-way. Choosing the same file again carries on.

export const RECHECK_MS = 30_000;

export function UnfinishedUploads({ api, workspaceId, sessions, onChanged }: {
  api: Api;
  workspaceId: string;
  sessions: UploadSession[];
  onChanged: () => void;
}) {
  const [ready, setReady] = useState<Set<string>>(new Set());
  const ours = sessions.filter((session) => session.status === 'planned' && !ready.has(session.id));
  const carryOn = sessions.filter((session) => session.status !== 'planned' || ready.has(session.id));
  const waiting = ours.map((session) => session.id).join(',');

  useEffect(() => {
    if (!waiting) return undefined;
    const ids = waiting.split(',');
    const look = async () => {
      for (const id of ids) {
        try {
          // reading a planned upload starts it on the server once storage answers again
          const answer = await api<{ upload: { status: string } }>(`/uploads/${encodeURIComponent(id)}`, {}, workspaceId);
          if (answer.upload.status !== 'planned') setReady((now) => new Set(now).add(id));
        } catch {
          // still down: look again later
        }
      }
    };
    const timer = window.setInterval(() => void look(), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [api, workspaceId, waiting]);

  const remove = async (id: string) => {
    await api(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }, workspaceId);
    onChanged();
  };
  if (!sessions.length) return null;
  return (
    <section className="cloud-unfinished" aria-label="Unfinished uploads" data-arrive="">
      <h3>Unfinished uploads</h3>
      {ours.length > 0 && (
        <>
          <p role="status">{`SelectaDJ couldn’t store ${ours.length === 1 ? 'this file' : 'these files'}. That was on our side, and nothing was lost. SelectaDJ checks again by itself and tells you when you can finish.`}</p>
          <ul>{ours.map((session) => (
            <li key={session.id} data-lift="row"><Truncate text={session.name} /><Action className="quiet" run={() => remove(session.id)} working="Removing…">Remove</Action></li>
          ))}</ul>
        </>
      )}
      {carryOn.length > 0 && (
        <>
          <p>{ready.size > 0 ? 'Storage is working again. Choose the same file again to finish it.' : 'Choose the same file again and SelectaDJ carries on from where it stopped.'}</p>
          <ul>{carryOn.map((session) => (
            <li key={session.id} data-lift="row"><Truncate text={session.name} /><small>{countOf(session.part_count, 'part')}</small><Action className="quiet" run={() => remove(session.id)} working="Removing…">Remove</Action></li>
          ))}</ul>
        </>
      )}
    </section>
  );
}
