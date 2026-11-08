import { KeyboardEvent, memo, RefObject, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, get, MixData, problemKind, ProblemKind } from '../api';
import { lucy, newId } from '../lucy/client';
import { isRunActive } from '../lucy/reducer';
import type { ConversationScope, LucyStatus, Selection } from '../lucy/types';
import { forgetSent, keepUnsent, unsentKey, useUnsent } from '../lucy/unsent';
import { useConversation } from '../lucy/useConversation';
import { RUN_WORDS } from '../lucy/words';
import { navigate, useLocationText } from '../router';
import { PageLink } from '../shell/PageLink';
import { Drawer, Problem, Skeleton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';
import { Approve } from './LucyApprove';
import { Composer, speechRecognition } from './LucyComposer';
import { blockedWords, gateOf, LucyClosed, LucyNotice, ProviderNote } from './LucyGate';
import { LucyHistory } from './LucyHistory';
import { ExamplePrompts, ProposalPane } from './LucyProposal';
import { LucySettings } from './LucySettings';
import { Announcer, Pending, Transcript, useAnnouncer, useStickToBottom } from './LucyTranscript';
import type { ViewProps } from './shared';
import '../styles/lucy.css';

/** Lucy: describe a mix in your own words, and Lucy plans it. Nothing is built, saved or played until
 * it's approved, and Lucy never starts, pauses or replaces the music by itself. Lucy being off,
 * unset or unreachable never gets in the way of Make a Mix. */

const SPLIT_AT = 1100;
const HISTORY_AT = 1280;
const HISTORY_KEY = 'selecta.lucy.history';

function parseScope(params: URLSearchParams): ConversationScope | null {
  const raw = params.get('scope') ?? '';
  const draft = /^draft:(\d+)$/.exec(raw);
  const scope: ConversationScope | null = raw === 'current' ? { kind: 'current' } : draft ? { kind: 'draft', draft: Number(draft[1]) } : null;
  if (!scope) return null;
  const occurrence = Number(params.get('occurrence'));
  const seam = Number(params.get('seam'));
  if (params.has('occurrence') && Number.isInteger(occurrence) && occurrence >= 0) scope.occurrence = occurrence;
  else if (params.has('seam') && Number.isInteger(seam) && seam > 0) scope.seam = seam;
  return scope;
}

function scopeOf(saved: Record<string, unknown> | undefined): ConversationScope | null {
  if (!saved || (saved.kind !== 'current' && saved.kind !== 'draft')) return null;
  const pick = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  return { kind: saved.kind, draft: pick(saved.draft), occurrence: pick(saved.occurrence), seam: pick(saved.seam) };
}

/** Positions come from the editor counting from 0; people count songs from 1. A transition is
 * numbered by the song it leads into, so transition 1 is between songs 1 and 2. */
function scopeWords(scope: ConversationScope): string {
  const base = scope.kind === 'current' ? 'Current mix' : `Draft ${scope.draft ?? ''}`.trim();
  if (typeof scope.occurrence === 'number') return `${base}, song at position ${scope.occurrence + 1}`;
  if (typeof scope.seam === 'number') return `${base}, transition ${scope.seam}`;
  return base;
}

const safeReturn = (from: string | null) => (from && from.startsWith('/') && !from.startsWith('//') ? from : null);

function useWidth(target: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') {
      const resized = () => setWidth(element.clientWidth);
      window.addEventListener('resize', resized);
      return () => window.removeEventListener('resize', resized);
    }
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return width;
}

function savedHistoryOpen(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Only what Lucy needs from the app, all of it stable, so the player's once-a-second updates don't
 * redraw the conversation. */
export type LucyProps = { conversation: string | null; setMixData: ViewProps['setMixData']; player: ViewProps['player'] };

export function Lucy({ conversation, setMixData, player }: LucyProps) {
  const page = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const tabsId = useId();
  const width = useWidth(page);
  const split = width >= SPLIT_AT;
  const still = useReducedMotion();
  const params = new URLSearchParams(useLocationText().split('?')[1] ?? '');
  const askedScope = parseScope(params);
  const backTo = safeReturn(params.get('from'));

  const [status, setStatus] = useState<LucyStatus | null>(null);
  const [statusProblem, setStatusProblem] = useState<{ kind: ProblemKind | 'old'; message: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historySheet, setHistorySheet] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(savedHistoryOpen);
  const [tab, setTab] = useState<'chat' | 'mix'>('chat');
  const [selection, setSelection] = useState<{ sel: Selection; label: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sending = useRef(false);
  const attempt = useRef<{ conversation: string; clientId: string; text: string } | null>(null);
  const refocus = useRef(false);

  const announcer = useAnnouncer();
  const convo = useConversation(conversation, announcer.say);
  const { view, revision } = convo;
  const unsent = useUnsent(conversation);
  const unsentNow = useRef(unsent);
  unsentNow.current = unsent;

  const readStatus = useCallback(async () => {
    try {
      setStatus(await lucy.status());
      setStatusProblem(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setStatusProblem({ kind: 'old', message: error.message });
      else setStatusProblem({ kind: problemKind(error), message: (error as Error).message });
    }
  }, []);
  useEffect(() => { void readStatus(); }, [readStatus]);
  useEffect(() => {
    if (statusProblem?.kind !== 'offline') return;
    const timer = window.setInterval(() => void readStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [statusProblem?.kind, readStatus]);
  // a stream that's refused may mean Lucy was turned off somewhere else
  useEffect(() => { if (convo.stream === 'refused') void readStatus(); }, [convo.stream, readStatus]);

  useEffect(() => {
    setSelection(null);
    setPending((was) => (was && was.conversation === conversation ? was : null));
    if (!refocus.current) return;
    refocus.current = false;
    // the address changed under the box being typed in, so put the cursor back once the page settles
    const frame = window.requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [conversation]);

  // once the server's copy of a sent message shows up, the stand-in goes
  useEffect(() => {
    if (pending?.state !== 'sent' || !pending.turn) return;
    if (view.messages.some((message) => message.turn === pending.turn)) {
      setPending(null);
      return;
    }
    if (convo.stream === 'live' || convo.stream === 'polling') return;
    const timer = window.setTimeout(convo.reload, 1500);
    return () => window.clearTimeout(timer);
  }, [pending, view.messages, convo.stream, convo.reload]);

  const gate = gateOf(status, statusProblem?.kind === 'old');
  const offline = statusProblem?.kind === 'offline';
  const blocked = convo.load.state === 'missing' ? 'This conversation isn’t here any more.' : blockedWords(gate, status, offline);
  const running = isRunActive(view.run);
  const live = convo.stream === 'live' || convo.stream === 'polling';
  const historyColumn = width >= HISTORY_AT && historyOpen;
  const lastMessage = view.messages[view.messages.length - 1];
  const settledCards = Object.values(view.cards).filter((card) => card.status !== 'queued' && card.status !== 'running').length;
  const contentKey = `${view.messages.length}:${lastMessage?.content.length ?? 0}:${lastMessage?.status}:${view.notes.length}:${view.planOrder.length}:${settledCards}:${pending?.state}:${view.permissions.length}`;
  const sticky = useStickToBottom(contentKey, view.messages.length, split || tab === 'chat');

  useEffect(() => {
    if (convo.load.state !== 'ready') return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    return () => window.cancelAnimationFrame(frame);
  }, [conversation, convo.load.state]);

  const focusBox = () => window.requestAnimationFrame(() => box.current?.focus());
  const fill = (text: string) => {
    unsent.change(text);
    setTab('chat');
    focusBox();
  };
  const ask = (sel: Selection, label: string) => {
    setSelection({ sel, label });
    setTab('chat');
    focusBox();
  };

  const send = async () => {
    const text = unsent.text.trim();
    if (!text || sending.current || blocked) return;
    sending.current = true;
    let id = conversation;
    unsent.hold();
    setPending({ conversation: id, text, state: 'sending' });
    try {
      if (!id) {
        const scope = askedScope ?? undefined;
        const made = await lucy.createConversation({ title: '', scope });
        id = made.id;
        forgetSent(null, text);
        refocus.current = true;
        setPending({ conversation: id, text, state: 'sending' });
        navigate(`/mixes/lucy/${made.id}${window.location.search}`, { replace: true });
      }
      const again = attempt.current?.conversation === id && attempt.current.text === text ? attempt.current : null;
      const mine = again ?? { conversation: id, clientId: newId(), text };
      attempt.current = mine;
      const accepted = await lucy.sendTurn(id, { client_id: mine.clientId, text, expected_revision: view.proposal?.currentId ?? null, ...(selection ? { selection: selection.sel } : {}) });
      attempt.current = null;
      forgetSent(id, text);
      setSelection(null);
      setPending({ conversation: id, text, state: 'sent', turn: accepted.turn.id });
    } catch (error) {
      const kind = problemKind(error);
      let message = 'Couldn’t send this.';
      if (error instanceof ApiError && error.code === 'stale_revision') {
        message = 'Your mix changed while you were writing. Have a look, then send again.';
        attempt.current = null;
        convo.reload();
      } else if (error instanceof ApiError && error.code === 'superseded') {
        message = 'A newer request took over. Send this again if you still want it.';
        attempt.current = null;
      } else if (error instanceof ApiError && error.status === 403) {
        message = error.message;
        attempt.current = null;
        void readStatus();
      } else if (kind === 'offline' || kind === 'server' || (error instanceof ApiError && error.status === 408)) {
        // Sending again uses the same name, so the server won't take it twice if it did arrive.
        message = 'Selecta didn’t answer, so it may not have arrived. Press Send to try again.';
      } else {
        message = (error as Error).message;
        attempt.current = null;
      }
      setPending({ conversation: id, text, state: 'failed', message });
      // the words go back in the box for this conversation, unless something new was typed meanwhile
      const shown = unsentNow.current;
      if (shown.key === unsentKey(id)) {
        if (!shown.text.trim()) shown.change(text);
      } else {
        keepUnsent(id, text);
      }
    } finally {
      sending.current = false;
    }
  };

  const reloadUnlessLive = () => { if (!live) convo.reload(); };
  const stop = async () => { if (conversation) { await lucy.stop(conversation); reloadUnlessLive(); } };
  const retry = async (turn: string) => { if (conversation) { await lucy.retry(conversation, turn); reloadUnlessLive(); } };
  const branch = async (message: string) => {
    if (!conversation) return;
    const made = await lucy.branchConversation(conversation, message);
    navigate(`/mixes/lucy/${made.id}`);
  };
  const decide = async (id: string, decision: 'allow' | 'deny') => { await lucy.decide(id, decision); reloadUnlessLive(); };
  const chooseBuiltin = async () => setStatus(await lucy.saveSettings({ provider: { kind: 'builtin' } }));
  const turnOn = async () => setStatus(await lucy.saveSettings({ enabled: true }));
  const startPlaying = async () => {
    // Save and play was confirmed, so the app's own player starts the mix the server just made current
    const next = await get<MixData>('/mix');
    setMixData(next);
    if (next.mix.length) await player.playFrom(0);
  };
  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    try { window.localStorage.setItem(HISTORY_KEY, next ? '1' : '0'); } catch { /* only this visit remembers */ }
  };
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'mix' : tab === 'chat' ? 'mix' : 'chat';
    setTab(next);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  };

  const shownScope = scopeOf(view.conversation?.scope) ?? (conversation ? null : askedScope);
  const voice = !!status?.phases.voice && !!speechRecognition();
  const threadTitle = view.conversation?.title || (conversation ? 'Conversation' : 'New conversation');

  const header = (
    <header className="lucy-head">
      <div className="lucy-title">
        <Icon name="thread" width={28} height={28} className="lucy-mark" />
        <div>
          <h1 className="display small">Lucy</h1>
          <p className="lede">Describe a mix. Lucy plans it; nothing is built until you approve it.</p>
        </div>
      </div>
      <div className="row wrap lucy-head-actions">
        {width >= HISTORY_AT
          ? <button type="button" aria-pressed={historyOpen} onClick={toggleHistory}>{historyOpen ? 'Hide conversations' : 'Show conversations'}</button>
          : <button type="button" aria-haspopup="dialog" onClick={() => setHistorySheet(true)}>Conversations</button>}
        <button type="button" aria-haspopup="dialog" disabled={!status} onClick={() => setSettingsOpen(true)}><Icon name="settings" width={16} height={16} /> Settings</button>
      </div>
      {(shownScope || backTo) && (
        <div className="row wrap lucy-scope">
          {shownScope && <span className="lucy-chip lucy-about">About: {scopeWords(shownScope)}</span>}
          {backTo && <PageLink to={backTo} className="button quiet">Back to editor</PageLink>}
        </div>
      )}
      {status && gate === 'open' && <ProviderNote status={status} onSettings={() => setSettingsOpen(true)} />}
    </header>
  );

  const settings = settingsOpen && status && (
    <Drawer title="Lucy settings" onClose={() => setSettingsOpen(false)}>
      <LucySettings status={status} onSaved={setStatus} />
    </Drawer>
  );

  if (!status && !statusProblem) {
    return <main className="page lucy" id="main" ref={page} aria-busy="true">{header}<Skeleton lines={4} label="Checking Lucy" /></main>;
  }
  if (gate === 'old' || gate === 'off') {
    return (
      <main className="page lucy" id="main" ref={page}>
        {header}
        <LucyClosed gate={gate} onTurnOn={turnOn} onSettings={() => setSettingsOpen(true)} />
        {settings}
      </main>
    );
  }

  const chat = (
    <>
      <h2 className="lucy-thread-title" dir="auto">{threadTitle}</h2>
      {convo.load.state === 'loading' && !pending && <Skeleton lines={4} label="Opening this conversation" />}
      {convo.load.state === 'failed' && <Problem retry={convo.reload}>Couldn’t open this conversation{convo.load.message ? `: ${convo.load.message}` : '.'}</Problem>}
      {convo.load.state === 'missing' ? (
        <div className="lucy-gate">
          <p><b>This conversation isn’t here any more.</b> It may have been deleted. Drafts saved from it are still in My Mixes.</p>
          <PageLink to="/mixes/lucy" className="button primary">Start a new conversation</PageLink>
        </div>
      ) : (convo.load.state === 'ready' || convo.load.state === 'idle' || (convo.load.state === 'loading' && !!pending)) && (
        <Transcript
          view={view}
          still={still}
          pending={pending}
          canBranch={!!conversation && !running}
          onBranch={branch}
          onRetry={retry}
          onDecide={decide}
          empty={(
            <div className="lucy-empty">
              <p><b>{shownScope ? `Ask Lucy about this mix (${scopeWords(shownScope)}).` : 'Tell Lucy what kind of mix you want.'}</b> Lucy shows you every song and transition it plans, and builds nothing until you approve it.</p>
              <ExamplePrompts onPick={fill} />
            </div>
          )}
        />
      )}
      {view.run && (running || view.run.state === 'failed') && (
        <p className={view.run.state === 'failed' ? 'warn' : 'hint lucy-run'}>
          {RUN_WORDS[view.run.state] ?? view.run.state}{running ? '…' : ''}{view.run.error ? ` ${view.run.error}` : ''}
        </p>
      )}
      <div className="lucy-dock">
        {sticky.fresh > 0 && <button type="button" className="lucy-new" onClick={sticky.jump}>New messages ({sticky.fresh})</button>}
        <Composer
          value={unsent.text}
          onChange={unsent.change}
          onSend={() => void send()}
          onStop={stop}
          running={running && !!conversation}
          sending={pending?.state === 'sending'}
          blocked={blocked}
          voice={voice}
          boxRef={box}
          above={selection && (
            <div className="lucy-selection">
              <span className="lucy-chip">About: <span dir="auto">{selection.label}</span></span>
              <button type="button" className="quiet" aria-label={`Stop asking about ${selection.label}`} onClick={() => setSelection(null)}><Icon name="close" width={16} height={16} /></button>
            </div>
          )}
        />
      </div>
    </>
  );

  const pane = (
    <ProposalPane
      proposal={view.proposal}
      revision={revision}
      phases={status?.phases ?? null}
      selection={selection?.sel ?? null}
      onAsk={ask}
      adopt={convo.adopt}
      reload={convo.reload}
      fillComposer={fill}
      approve={(shown, isCurrent) => (
        <Approve
          revision={shown}
          isCurrent={isCurrent}
          blocked={status && !status.phases.commit ? 'Saving is turned off in Lucy’s settings.' : !status ? 'Can’t reach Selecta right now.' : ''}
          seen={view.commits}
          onStale={convo.reload}
          startPlaying={startPlaying}
        />
      )}
    />
  );

  return (
    <main className={`page lucy ${split ? 'is-split' : 'is-stacked'}`} id="main" ref={page}>
      {header}
      {(offline || convo.stream === 'reconnecting') && (
        <p className="lucy-banner" role="status">Can’t reach Selecta right now. What’s shown may be out of date, and anything you type is kept.</p>
      )}
      {statusProblem && !offline && statusProblem.kind !== 'old' && !status && (
        <Problem retry={readStatus}>Couldn’t check Lucy’s settings: {statusProblem.message}</Problem>
      )}
      {convo.stream === 'refused' && (
        <p className="lucy-banner" role="status">Live updates have stopped. <button type="button" className="lucy-link" onClick={convo.reload}>Catch up now</button></p>
      )}
      {status && <LucyNotice gate={gate} status={status} onBuiltin={chooseBuiltin} onSettings={() => setSettingsOpen(true)} />}
      <div className={`lucy-layout ${historyColumn ? 'has-history' : ''}`}>
        {historyColumn && <aside className="lucy-history-col"><LucyHistory currentId={conversation} refreshKey={`${conversation}:${view.conversation?.title ?? ''}`} /></aside>}
        {!split && (
          <div className="lucy-tabs" role="tablist" aria-label="Lucy">
            {(['chat', 'mix'] as const).map((name) => (
              <button key={name} type="button" role="tab" id={`${tabsId}-${name}`} aria-selected={tab === name} aria-controls={`${tabsId}-${name}-panel`}
                tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={tabKeys}>
                {name === 'chat' ? 'Chat' : 'Your mix'}
              </button>
            ))}
          </div>
        )}
        <div className="lucy-chat" id={`${tabsId}-chat-panel`} role={split ? undefined : 'tabpanel'} aria-labelledby={split ? undefined : `${tabsId}-chat`} hidden={!split && tab !== 'chat'}>
          {chat}
        </div>
        <div className="lucy-side" id={`${tabsId}-mix-panel`} role={split ? undefined : 'tabpanel'} aria-labelledby={split ? undefined : `${tabsId}-mix`} hidden={!split && tab !== 'mix'}>
          {pane}
        </div>
      </div>
      <Announcer words={announcer.words} />
      {historySheet && (
        <Drawer title="Conversations" onClose={() => setHistorySheet(false)}>
          <LucyHistory currentId={conversation} refreshKey={`${conversation}:${view.conversation?.title ?? ''}`} onPicked={() => setHistorySheet(false)} />
        </Drawer>
      )}
      {settings}
    </main>
  );
}

export default memo(Lucy);
