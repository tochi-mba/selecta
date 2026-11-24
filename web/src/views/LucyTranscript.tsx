import { Fragment, ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { LucyView } from '../lucy/reducer';
import type { Message } from '../lucy/types';
import { Action } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PermissionCard, PlanGroupView } from './LucyCards';

/** The conversation itself. It's a log a screen reader can browse, but it doesn't speak each word as
 * it arrives: a separate, quiet announcer says what happened at most every couple of seconds. Text is
 * only ever shown as text. Nothing in a message can run an action or open a link. */

const BOLD = /\*\*(.+?)\*\*/g;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function inline(line: string, key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(BOLD)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(line.slice(last, at));
    parts.push(<strong key={`${key}-${at}`}>{match[1]}</strong>);
    last = at + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/** Paragraphs, line breaks, **bold** and simple lists. Anything else stays exactly as typed. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let run: { kind: 'p' | 'ul' | 'ol'; lines: string[] } | null = null;
  const close = () => {
    if (!run) return;
    const key = `b${blocks.length}`;
    if (run.kind === 'p') {
      blocks.push(<p key={key}>{run.lines.map((line, index) => <Fragment key={index}>{index > 0 && <br />}{inline(line, `${key}-${index}`)}</Fragment>)}</p>);
    } else {
      const List = run.kind;
      const marker = run.kind === 'ul' ? BULLET : NUMBERED;
      blocks.push(<List key={key}>{run.lines.map((line, index) => <li key={index}>{inline(line.replace(marker, ''), `${key}-${index}`)}</li>)}</List>);
    }
    run = null;
  };
  for (const line of lines) {
    const kind = !line.trim() ? null : BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : 'p';
    if (kind === null) {
      close();
      continue;
    }
    if (!run || run.kind !== kind) {
      close();
      run = { kind, lines: [] };
    }
    run.lines.push(line);
  }
  close();
  return <div className="lucy-text" dir="auto">{blocks}</div>;
}

const STATE_WORDS: Partial<Record<Message['status'], string>> = {
  streaming: 'Replying…',
  interrupted: 'Interrupted - this reply is incomplete',
  cancelled: 'Stopped - this reply is incomplete',
  failed: 'Didn’t finish',
};

function MessageItem({ message, superseded, onBranch, onRetry, canBranch, latest, onEdit, onRate }: {
  message: Message;
  superseded: boolean;
  onBranch: (id: string) => Promise<void>;
  onRetry: (turn: string) => Promise<void>;
  canBranch: boolean;
  /** The newest answer: it can be asked again even when it finished. */
  latest?: boolean;
  /** Put the person's own words back in the box to change and send again. */
  onEdit?: (text: string) => void;
  /** Thumbs up or down on an answer (Cloud keeps it for Lucy's evaluation). */
  onRate?: (id: string, rating: 'up' | 'down') => Promise<void>;
}) {
  const headingId = useId();
  const who = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Lucy' : 'Note';
  const state = message.role === 'user' ? (superseded ? 'Replaced by a newer request' : '') : STATE_WORDS[message.status] ?? '';
  const unfinished = message.role === 'assistant' && ['interrupted', 'cancelled', 'failed'].includes(message.status);
  const answered = message.role === 'assistant' && message.status !== 'streaming' && !!message.content;
  const when = timeOf(message.created_at);
  return (
    <li className={`lucy-msg is-${message.role} is-${message.status}`}>
      <article aria-labelledby={headingId}>
        <h3 id={headingId} className="lucy-msg-who">
          {who}{state && <span className="lucy-msg-state"> · {state}</span>}
          {when && <time className="lucy-msg-time" dateTime={when.iso}>{when.words}</time>}
        </h3>
        {message.content ? <RichText text={message.content} /> : message.status === 'streaming' ? <p className="soft lucy-thinking">Thinking…</p> : null}
        {(canBranch || unfinished || answered || (onEdit && message.role === 'user')) && !message.id.startsWith('turn:') && message.status !== 'streaming' && (
          <div className="lucy-msg-actions">
            {(unfinished || (answered && latest)) && message.turn && <Action className="quiet" working="Trying again…" run={() => onRetry(message.turn!)}>Try again</Action>}
            {answered && <CopyAnswer text={message.content} />}
            {answered && onRate && <RateAnswer id={message.id} rated={(message.meta?.rating as 'up' | 'down' | undefined) ?? null} onRate={onRate} />}
            {latest && answered && onEdit && Array.isArray(message.meta?.followups) && (message.meta.followups as string[]).slice(0, 2).map((ask) => (
              <button key={ask} type="button" className="lucy-followup" onClick={() => onEdit(ask)}>{ask}</button>
            ))}
            {onEdit && message.role === 'user' && <button type="button" className="quiet" onClick={() => onEdit(message.content)} aria-label="Edit and send again: puts these words back in the box">Edit</button>}
            {canBranch && <Action className="quiet" working="Branching…" run={() => onBranch(message.id)} aria-label={`Branch from here: a new conversation from this ${who === 'You' ? 'message of yours' : 'reply'}`}>Branch from here</Action>}
          </div>
        )}
      </article>
    </li>
  );
}

/** When a message was written, as a clock time today or a short date, for the hover/focus line. */
function timeOf(value: Message['created_at']): { iso: string; words: string } | null {
  const at = typeof value === 'number' ? new Date(value * 1000) : value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const today = new Date().toDateString() === at.toDateString();
  const words = today
    ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { iso: at.toISOString(), words };
}

/** Was this answer useful? One press, either way; pressing the same again takes it back. */
function RateAnswer({ id, rated, onRate }: { id: string; rated: 'up' | 'down' | null; onRate: (id: string, rating: 'up' | 'down') => Promise<void> }) {
  const [mine, setMine] = useState(rated);
  const rate = async (rating: 'up' | 'down') => {
    const before = mine;
    setMine(rating);
    try { await onRate(id, rating); } catch { setMine(before); }
  };
  return (
    <span className="lucy-rate" role="group" aria-label="Was this answer useful?">
      <button type="button" className="quiet" aria-pressed={mine === 'up'} title="Tell SelectaDJ this was a good answer" onClick={() => void rate('up')}><Icon name="check" size="compact" /> Good answer</button>
      <button type="button" className="quiet" aria-pressed={mine === 'down'} title="Tell SelectaDJ this answer missed" onClick={() => void rate('down')}><Icon name="close" size="compact" /> Bad answer</button>
    </span>
  );
}

/** Copy one answer's text; says so for a moment, and politely for a screen reader. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* the browser refused; nothing to undo */ }
  };
  return (
    <button type="button" className="quiet" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy this answer'}>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export type Pending = { conversation: string | null; text: string; state: 'sending' | 'sent' | 'failed'; message?: string; turn?: string };

type Entry = { key: number; order: number; node: ReactNode };

export function Transcript({ view, still, pending, empty, canBranch, onBranch, onRetry, onDecide, onEdit, onRate, onOlder }: {
  view: LucyView;
  still: boolean;
  pending: Pending | null;
  empty: ReactNode;
  canBranch: boolean;
  onBranch: (id: string) => Promise<void>;
  onRetry: (turn: string) => Promise<void>;
  onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void>;
  onEdit?: (text: string) => void;
  onRate?: (id: string, rating: 'up' | 'down') => Promise<void>;
  onOlder?: () => Promise<void>;
}) {
  const newest = [...view.messages].reverse().find((message) => message.role === 'assistant')?.id;
  const entries: Entry[] = view.messages.map((message) => ({
    key: message.seq,
    order: 0,
    node: <MessageItem key={message.id} message={message} superseded={!!message.turn && !!view.superseded[message.turn]} onBranch={onBranch} onRetry={onRetry} canBranch={canBranch} latest={message.id === newest} onEdit={onEdit} onRate={onRate} />,
  }));
  for (const plan of view.planOrder) {
    const group = view.plans[plan];
    if (!group) continue;
    const cards = group.steps.map((key) => view.cards[key]).filter(Boolean);
    const asked = view.messages.find((message) => message.role === 'user' && message.turn === group.turn);
    const answered = view.messages.find((message) => message.role === 'assistant' && message.turn === group.turn);
    // the steps sit between what was asked and Lucy's answer to it
    const key = asked ? asked.seq : answered ? answered.seq : Number.MAX_SAFE_INTEGER;
    entries.push({ key, order: asked ? 1 : -1, node: <li key={`plan-${plan}`} className="lucy-log-plan"><PlanGroupView group={group} cards={cards} still={still} /></li> });
  }
  for (const note of view.notes) {
    entries.push({ key: note.afterSeq, order: 2, node: <li key={note.id} className={`lucy-note is-${note.tone}`}><p>{note.text}</p></li> });
  }
  entries.sort((a, b) => a.key - b.key || a.order - b.order);
  const waiting = view.permissions.filter((permission) => permission.status === 'pending');
  // the stand-in stays until the server's own copy of the message is on screen, never both at once
  const showPending = !!pending && !(pending.turn && view.messages.some((message) => message.turn === pending.turn));
  return (
    <section className="lucy-transcript" aria-label="Conversation with Lucy">
      {!entries.length && !showPending && empty}
      {view.more && onOlder && <p className="lucy-older"><Action className="quiet" working="Reading…" run={onOlder}>Show earlier messages</Action></p>}
      <div role="log" aria-live="off" aria-label="Messages">
        <ol className="lucy-log">
          {entries.map((entry) => entry.node)}
          {showPending && (
            <li className={`lucy-msg is-user is-${pending.state}`}>
              <article aria-label="Your message">
                <h3 className="lucy-msg-who">You<span className="lucy-msg-state"> · {pending.state === 'sending' ? 'Sending…' : pending.state === 'sent' ? 'Sent' : 'Not sent'}</span></h3>
                <RichText text={pending.text} />
                {pending.state === 'failed' && <p className="warn">{pending.message ?? 'Couldn’t send this.'} Your words are back in the box below.</p>}
              </article>
            </li>
          )}
        </ol>
      </div>
      {waiting.map((permission) => <PermissionCard key={permission.id} permission={permission} onDecide={onDecide} />)}
    </section>
  );
}

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;

/** Keeps the newest message in view only while someone is already reading at the bottom. Anyone who
 * has scrolled up to read stays where they are, and gets a count of what's new instead. */
export function useStickToBottom(contentKey: string, messages: number, active: boolean, scope: string | null = null) {
  // null until it's known: a conversation that has just opened is where the page put it (the top, or
  // the newest message when it's still going), never pulled down just because it loaded (LX, 2026-11-12:
  // a finished conversation opened about 360px down, under its own heading)
  const atBottom = useRef<boolean | null>(null);
  const opened = useRef(scope);
  if (opened.current !== scope) {
    opened.current = scope;
    atBottom.current = null;
  }
  const [fresh, setFresh] = useState(0);
  const seen = useRef(messages);
  useEffect(() => {
    const scrolled = () => {
      atBottom.current = nearBottom();
      if (atBottom.current) setFresh(0);
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => window.removeEventListener('scroll', scrolled);
  }, []);
  useLayoutEffect(() => {
    if (atBottom.current === null) atBottom.current = nearBottom();
    if (active && atBottom.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [contentKey, active]);
  useEffect(() => {
    const added = messages - seen.current;
    seen.current = messages;
    if (added > 0 && !(active && atBottom.current)) setFresh((count) => count + added);
    if (added < 0) setFresh(0);
  }, [messages, active]);
  const jump = useCallback(() => {
    atBottom.current = true;
    setFresh(0);
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, []);
  return { fresh, jump };
}

const SAY_EVERY_MS = 2000;

/** Collects what's worth saying and says it at most once every two seconds, in one sentence. */
export function useAnnouncer() {
  const [words, setWords] = useState('');
  const queued = useRef<string[]>([]);
  const lastAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const speak = useCallback(() => {
    timer.current = undefined;
    const said = [...new Set(queued.current)];
    queued.current = [];
    if (!said.length) return;
    lastAt.current = Date.now();
    setWords(`${said.join('. ')}.`);
  }, []);
  const say = useCallback((phrases: string[]) => {
    queued.current.push(...phrases);
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(speak, Math.max(0, lastAt.current + SAY_EVERY_MS - Date.now()));
  }, [speak]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { words, say };
}

export function Announcer({ words }: { words: string }) {
  return <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{words}</div>;
}
