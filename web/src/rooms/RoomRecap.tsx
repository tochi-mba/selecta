import { useEffect, useState } from 'react';
import { Action } from '../ui/controls';

// Tonight in numbers, for the host (ADR-0488, flag `rooms.recap`): the totals of the room that
// just ended, above the form that opens the next one. Totals only: no guest is named.
//
// The server says the recap in words (`lines`, its title first), so the host's card, a guest's
// ended screen and a paired screen all read the same sentences. Copy puts them on the
// clipboard; Save image draws them on a canvas in this browser, so nothing is uploaded.

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;

function drawImage(lines: readonly string[]): string {
  const width = 1080;
  const height = 240 + lines.length * 78;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext('2d');
  if (!pen) return '';
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--ink').trim() || 'CanvasText';
  pen.fillStyle = styles.getPropertyValue('--surface-base').trim() || 'Canvas';
  pen.fillRect(0, 0, width, height);
  pen.fillStyle = ink;
  pen.font = '700 56px system-ui, sans-serif';
  pen.fillText(lines[0] ?? '', 72, 120, width - 144);
  pen.font = '500 40px system-ui, sans-serif';
  lines.slice(1).forEach((line, index) => pen.fillText(line, 72, 216 + index * 78, width - 144));
  pen.font = '600 28px system-ui, sans-serif';
  pen.fillText('SelectaDJ', 72, height - 56);
  return canvas.toDataURL('image/png');
}

export function RoomRecap({ api, workspaceId, roomId, tell }: {
  api: Api; workspaceId: string; roomId: string;
  tell: (words: string, problem?: boolean) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    api<{ lines: string[] }>(`/rooms/${encodeURIComponent(roomId)}/recap`, {}, workspaceId)
      .then((answer) => { if (live) setLines(answer.lines ?? []); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [api, workspaceId, roomId]);

  // a room with no recap (it was off, or nobody joined) shows nothing here
  if (lines.length < 2) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(lines.join('\n')); tell('Copied.'); } catch { tell('Couldn’t copy here. Select the lines and copy them.', true); }
  };
  const saveImage = async () => {
    const url = drawImage(lines);
    if (!url) { tell('This browser can’t draw the image.', true); return; }
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tonight-in-numbers.png';
    link.click();
  };
  return (
    <section className="room-card room-recap" aria-labelledby="recap-title" data-testid="room-recap">
      <h3 id="recap-title">Tonight in numbers</h3>
      <p className="room-help">{lines[0].replace(/: tonight in numbers$/, '')} has ended. These are its totals; no guest is named.</p>
      <ul className="room-list">{lines.slice(1).map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="room-open-row">
        <Action type="button" run={copy}>Copy as text</Action>
        <Action type="button" className="quiet" run={saveImage}>Save image</Action>
      </div>
    </section>
  );
}
