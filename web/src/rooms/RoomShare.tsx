import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Action, Workspace } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useFeelPart } from './feelHooks';
import { qrSvg } from './qr';

// How guests get in: the QR code, the room code in large type, and the link with Copy. The same
// three are shown again at full size (RoomQrScreen) for a wall, a TV or a phone held up across
// the room.

const COPIED_MS = 2500;

/** Copy the room's link, and say "Copied" for a moment where the button was pressed. */
export function useCopyLink(link: string, failed: (words: string) => void) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch { failed('Couldn’t copy the link. Select it and copy it yourself.'); }
  };
  return { copied, copy };
}

export function CopyWords({ copied, children }: { copied: boolean; children: string }) {
  return copied ? <><Icon name="check" size="compact" /> Copied</> : <>{children}</>;
}

/** The room code. When it has just arrived (a room opened here, with moments on) its characters
 * come in one after another; a screen reader hears the code once, whole, either way. */
function RoomCode({ code, arriving, testId }: { code: string | null; arriving: boolean; testId?: string }) {
  if (!arriving || !code) return <p className="room-code" data-testid={testId}>{code}</p>;
  return (
    <p className="room-code" data-testid={testId}>
      <span className="visually-hidden">{code}</span>
      <span className="room-code-chars" data-stagger="" aria-hidden="true">
        {[...code].map((char, index) => <span key={index} style={{ '--i': index } as CSSProperties}>{char}</span>)}
      </span>
    </p>
  );
}

export function RoomShare({ name, code, link, copied, copy, onFullScreen, arriving = false }: {
  name: string; code: string | null; link: string; copied: boolean; copy: () => Promise<void>; onFullScreen: () => void;
  /** the room was just opened on this page: the code and the QR arrive as a moment (ADR-0477) */
  arriving?: boolean;
}) {
  const moments = useFeelPart('moments');
  const wave = arriving && moments;
  return (
    <section className="room-card room-share" aria-labelledby="share-title">
      <header className="room-card-head">
        <h3 id="share-title">Invite guests</h3>
      </header>
      {link && (
        <div className="room-share-body">
          <button type="button" className="room-qr-button" onClick={onFullScreen} aria-label="Show QR code full screen" title="Show full screen">
            <span className="room-qr" data-testid="room-qr" data-link={link} data-qr-wave={wave || undefined} dangerouslySetInnerHTML={{ __html: qrSvg(link, `QR code to join ${name}`, wave) }} />
          </button>
          <div className="room-share-words">
            <p className="room-eyebrow">Room code</p>
            <RoomCode code={code} arriving={wave} testId="room-code" />
            <div className="room-link">
              <a href={link} target="_blank" rel="noreferrer" title={link}>{link.replace(/^https?:\/\//, '')}</a>
              <Action type="button" className="room-copy" run={copy} aria-label="Copy link"><CopyWords copied={copied}>Copy</CopyWords></Action>
            </div>
            <p className="room-help">Guests scan the code or open the link. No app, no account.</p>
          </div>
        </div>
      )}
      {/* said once for a screen reader, wherever Copy was pressed */}
      <span className="visually-hidden" role="status">{copied ? 'Link copied.' : ''}</span>
    </section>
  );
}

/** The QR code and room code as large as the screen allows, for everyone in the room to scan. */
export function RoomQrScreen({ name, code, link, onClose }: { name: string; code: string | null; link: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  // shown to a room full of guests on purpose: the code comes in as a moment each time it is opened
  const wave = useFeelPart('moments');
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch { /* the browser said no: the large view stays as it is */ }
  };
  return (
    <Workspace title={`Join ${name}`} onClose={onClose}>
      <div className="room-qr-screen" ref={stage} data-testid="room-qr-screen">
        <div className="room-qr room-qr-large" data-qr-wave={wave || undefined} dangerouslySetInnerHTML={{ __html: qrSvg(link, `QR code to join ${name}`, wave) }} />
        <div className="room-qr-words">
          <p className="room-eyebrow">Scan to ask for songs</p>
          <p className="room-qr-name">{name}</p>
          <RoomCode code={code} arriving={wave} />
          <p className="room-qr-link">{link.replace(/^https?:\/\//, '')}</p>
          {typeof document !== 'undefined' && document.fullscreenEnabled && (
            <button type="button" className="room-qr-full" onClick={() => void toggle()}><Icon name="expand" size="toolbar" /> {full ? 'Leave full screen' : 'Fill the screen'}</button>
          )}
        </div>
      </div>
    </Workspace>
  );
}
