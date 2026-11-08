import type {
  Card, CardStatus, Conversation, Family, LucyEvent, Message, MessageRole, MessageStatus, Permission, Revision,
  RevisionSummary, Run, RunState, Snapshot,
} from './types';

/** One conversation as the page shows it, built from a snapshot and then the events after it. Pure:
 * the same snapshot and events always give the same view. A step can only move forward, so a late or
 * repeated event never takes a card back to an earlier state. Revisions themselves are never edited
 * here: a new or changed revision only says the current one has to be read again. */

export type Note = { id: string; text: string; tone: 'info' | 'problem'; afterSeq: number; turn: string | null };

export type PlannedStep = { id: string; op: string; family: Family; title: string; note: string | null };

export type PlanGroup = {
  plan: string;
  run: string;
  turn: string;
  steps: string[];
  planned: PlannedStep[];
  done: boolean;
  ok: boolean | null;
  duration_ms: number | null;
};

export type ProposalState = { id: string; currentId: string | null; history: RevisionSummary[] };

export type Usage = { tokens_in: number; tokens_out: number; cost_usd: number | null; estimated: boolean };

export type CommitNote = { status: string; draft_id: number | null; name: string | null };

export type LucyView = {
  conversation: Conversation | null;
  messages: Message[];
  cards: Record<string, Card>;
  plans: Record<string, PlanGroup>;
  planOrder: string[];
  run: Run | null;
  usage: Usage | null;
  permissions: Permission[];
  proposal: ProposalState | null;
  /** Goes up whenever the current revision has to be read again. */
  revisionTick: number;
  /** Goes up when a render job changed, so readiness can be checked again. */
  readinessTick: number;
  notes: Note[];
  superseded: Record<string, string>;
  commits: Record<string, CommitNote>;
  cursor: number;
  loaded: boolean;
};

export type LucyAction =
  | { type: 'reset' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'events'; events: LucyEvent[] }
  | { type: 'current'; revision: Revision };

export const EMPTY_VIEW: LucyView = {
  conversation: null,
  messages: [],
  cards: {},
  plans: {},
  planOrder: [],
  run: null,
  usage: null,
  permissions: [],
  proposal: null,
  revisionTick: 0,
  readinessTick: 0,
  notes: [],
  superseded: {},
  commits: {},
  cursor: 0,
  loaded: false,
};

export const ACTIVE_RUN: ReadonlySet<RunState> = new Set(['interpreting', 'running_tools', 'evaluating', 'preparing', 'streaming', 'awaiting_permission']);
export const isRunActive = (run: Run | null) => !!run && ACTIVE_RUN.has(run.state);

const SETTLED: ReadonlySet<CardStatus> = new Set(['completed', 'skipped', 'cancelled']);
export const isSettled = (status: CardStatus) => SETTLED.has(status) || status === 'failed';
const RANK: Record<CardStatus, number> = { queued: 0, retrying: 1, running: 2, progress: 3, completed: 4, failed: 4, skipped: 4, cancelled: 4 };
const STATUSES = new Set(Object.keys(RANK));

export const cardKey = (plan: string, step: string) => `${plan}/${step}`;

/** Whether a step may move from one state to the next. Completed, skipped and cancelled are final. A
 * failed step can only be retried. A newer attempt outranks anything left over from an older one. */
export function canAdvance(from: CardStatus, to: CardStatus, fromAttempt: number, toAttempt: number): boolean {
  if (SETTLED.has(from)) return false;
  if (toAttempt < fromAttempt) return false;
  if (from === 'failed') return to === 'retrying' || toAttempt > fromAttempt;
  if (toAttempt > fromAttempt) return true;
  if (from === 'progress' && to === 'progress') return true;
  if ((from === 'running' || from === 'progress') && to === 'retrying') return true;
  return RANK[to] > RANK[from];
}

const bySeq = (a: Message, b: Message) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const lastSeq = (messages: Message[]) => messages.reduce((top, message) => Math.max(top, message.seq), 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function planFromCards(cards: Card[]): { plans: Record<string, PlanGroup>; planOrder: string[] } {
  const plans: Record<string, PlanGroup> = {};
  const planOrder: string[] = [];
  for (const card of cards) {
    let group = plans[card.plan];
    if (!group) {
      group = { plan: card.plan, run: card.run, turn: card.turn, steps: [], planned: [], done: false, ok: null, duration_ms: null };
      plans[card.plan] = group;
      planOrder.push(card.plan);
    }
    group.steps.push(cardKey(card.plan, card.step));
  }
  for (const plan of planOrder) {
    const group = plans[plan];
    const own = cards.filter((card) => card.plan === plan);
    group.done = own.every((card) => isSettled(card.status));
    group.ok = group.done ? !own.some((card) => card.status === 'failed') : null;
  }
  return { plans, planOrder };
}

function fromSnapshot(snapshot: Snapshot, before: LucyView): LucyView {
  const cards: Record<string, Card> = {};
  for (const card of snapshot.cards ?? []) cards[cardKey(card.plan, card.step)] = card;
  const proposal = snapshot.proposal
    ? { id: snapshot.proposal.id, currentId: snapshot.proposal.current?.id ?? snapshot.proposal.history.find((item) => item.current)?.id ?? null, history: [...snapshot.proposal.history].sort((a, b) => a.number - b.number) }
    : null;
  return {
    ...EMPTY_VIEW,
    conversation: snapshot.conversation,
    messages: [...(snapshot.messages ?? [])].sort(bySeq),
    cards,
    ...planFromCards(snapshot.cards ?? []),
    run: snapshot.run,
    permissions: snapshot.permissions ?? [],
    proposal,
    // the snapshot carries the current revision itself, so it doesn't need reading again
    revisionTick: before.revisionTick,
    readinessTick: before.readinessTick,
    commits: before.conversation?.id === snapshot.conversation.id ? before.commits : {},
    cursor: num(snapshot.cursor),
    loaded: true,
  };
}

function upsertMessage(messages: Message[], id: string, change: (found: Message | null) => Message | null): Message[] {
  const at = messages.findIndex((message) => message.id === id);
  const next = change(at >= 0 ? messages[at] : null);
  if (!next) return messages;
  const copy = [...messages];
  if (at >= 0) copy[at] = next;
  else copy.push(next);
  return copy.sort(bySeq);
}

function newMessage(event: LucyEvent, id: string, role: MessageRole, seq: number, content = '', status: MessageStatus = 'streaming'): Message {
  return { id, seq, role, turn: event.turn, run: event.run, content, status, revision: null, meta: {}, created_at: event.at };
}

function note(view: LucyView, event: LucyEvent, words: string, tone: Note['tone']): Note[] {
  if (!words) return view.notes;
  return [...view.notes, { id: `note-${event.id}`, text: words, tone, afterSeq: lastSeq(view.messages), turn: event.turn }];
}

function stepEvent(view: LucyView, event: LucyEvent, status: CardStatus): LucyView {
  if (!event.plan || !event.step) return view;
  const key = cardKey(event.plan, event.step);
  const payload = (event.payload ?? {}) as Partial<Card>;
  const before = view.cards[key];
  const attempt = num(payload.attempt, before?.attempt ?? 1);
  if (before && !canAdvance(before.status, status, before.attempt, attempt)) return view;
  const defined = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<Card>;
  const base: Card = before ?? { plan: event.plan, step: event.step, run: '', turn: '', op: '', family: 'other', title: '', status, attempt, notices: [], visual: {} };
  const card: Card = {
    ...base,
    ...defined,
    plan: event.plan,
    step: event.step,
    run: event.run ?? base.run,
    turn: event.turn ?? base.turn,
    notices: Array.isArray(defined.notices) ? defined.notices : base.notices,
    visual: defined.visual && typeof defined.visual === 'object' ? defined.visual : base.visual,
    status,
    attempt,
  };
  let { plans, planOrder } = view;
  if (!plans[event.plan]) {
    plans = { ...plans, [event.plan]: { plan: event.plan, run: card.run, turn: card.turn, steps: [key], planned: [], done: false, ok: null, duration_ms: null } };
    planOrder = [...planOrder, event.plan];
  } else if (!plans[event.plan].steps.includes(key)) {
    plans = { ...plans, [event.plan]: { ...plans[event.plan], steps: [...plans[event.plan].steps, key] } };
  }
  return { ...view, cards: { ...view.cards, [key]: card }, plans, planOrder };
}

function summaryOf(payload: Record<string, unknown>): RevisionSummary {
  return {
    id: text(payload.revision),
    number: num(payload.number),
    parent: null,
    branch: text(payload.branch),
    kind: (text(payload.kind) || 'revise') as RevisionSummary['kind'],
    hash: text(payload.hash),
    summary: text(payload.summary),
    created_at: '',
    songs: num(payload.songs),
    title: text(payload.title),
    ready_only: payload.ready_only === true,
    current: payload.current === true,
  };
}

function withCurrent(proposal: ProposalState, current: string): ProposalState {
  return { ...proposal, currentId: current, history: proposal.history.map((item) => ({ ...item, current: item.id === current })) };
}

function fold(view: LucyView, event: LucyEvent): LucyView {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const next = applyEvent(view, event, payload);
  return next.cursor >= event.id ? next : { ...next, cursor: event.id };
}

function applyEvent(view: LucyView, event: LucyEvent, payload: Record<string, unknown>): LucyView {
  if (event.type.startsWith('step.')) {
    const name = event.type.slice(5);
    const status = name === 'started' ? 'running' : name;
    return STATUSES.has(status) ? stepEvent(view, event, status as CardStatus) : view;
  }
  switch (event.type) {
    case 'conversation.updated':
      return view.conversation ? { ...view, conversation: { ...view.conversation, title: text(payload.title) || view.conversation.title } } : view;
    case 'turn.accepted': {
      const turn = event.turn;
      if (!turn || view.messages.some((message) => message.role === 'user' && message.turn === turn)) return view;
      return { ...view, messages: [...view.messages, newMessage(event, `turn:${turn}`, 'user', num(payload.seq, lastSeq(view.messages) + 1), text(payload.text), 'complete')].sort(bySeq) };
    }
    case 'turn.superseded':
      if (!event.turn) return view;
      return { ...view, superseded: { ...view.superseded, [event.turn]: text(payload.by) }, notes: note(view, event, 'That request was replaced by a newer one.', 'info') };
    case 'run.state': {
      const state = text(payload.state) as RunState;
      if (!state || !event.run) return view;
      const same = view.run?.id === event.run ? view.run : null;
      const run: Run = {
        id: event.run,
        turn: event.turn ?? same?.turn ?? '',
        state,
        cycles: num(payload.cycles, same?.cycles ?? 0),
        steps: num(payload.steps, same?.steps ?? 0),
        limits: same?.limits ?? {},
        usage: same?.usage ?? {},
        error: typeof payload.error === 'string' ? payload.error : null,
      };
      return { ...view, run };
    }
    case 'run.limit':
      return { ...view, notes: note(view, event, text(payload.text) || `Lucy reached its limit of ${num(payload.max)} for ${text(payload.limit) || 'this request'}.`, 'info') };
    case 'run.usage':
      return { ...view, usage: { tokens_in: num(payload.tokens_in), tokens_out: num(payload.tokens_out), cost_usd: typeof payload.cost_usd === 'number' ? payload.cost_usd : null, estimated: payload.estimated === true } };
    case 'message.started': {
      const id = text(payload.message);
      if (!id) return view;
      const role = (text(payload.role) || 'assistant') as MessageRole;
      let messages = view.messages;
      // the server's own copy of what was typed replaces the stand-in from `turn.accepted`
      if (role === 'user' && event.turn) messages = messages.filter((message) => message.id !== `turn:${event.turn}`);
      messages = upsertMessage(messages, id, (found) => (found
        ? { ...found, role, seq: num(payload.seq, found.seq) }
        : newMessage(event, id, role, num(payload.seq, lastSeq(messages) + 1))));
      return { ...view, messages };
    }
    case 'message.delta': {
      const id = text(payload.message);
      const delta = text(payload.text);
      if (!id || !delta) return view;
      return {
        ...view,
        messages: upsertMessage(view.messages, id, (found) => {
          if (!found) return newMessage(event, id, 'assistant', lastSeq(view.messages) + 1, delta);
          // a finished message's text is final; a late delta can't add to it
          return found.status === 'streaming' ? { ...found, content: found.content + delta } : null;
        }),
      };
    }
    case 'message.completed': {
      const id = text(payload.message);
      if (!id) return view;
      const status = (text(payload.status) || 'complete') as MessageStatus;
      return {
        ...view,
        messages: upsertMessage(view.messages, id, (found) => {
          const content = typeof payload.content === 'string' ? payload.content : found?.content ?? '';
          return found ? { ...found, status, content } : newMessage(event, id, 'assistant', lastSeq(view.messages) + 1, content, status);
        }),
      };
    }
    case 'plan.started': {
      if (!event.plan) return view;
      const planned: PlannedStep[] = (Array.isArray(payload.steps) ? payload.steps : []).map((step: Record<string, unknown>) => ({
        id: text(step?.id), op: text(step?.op), family: (text(step?.family) || 'other') as Family, title: text(step?.title), note: typeof step?.note === 'string' ? step.note : null,
      })).filter((step: PlannedStep) => step.id);
      const existing = view.plans[event.plan];
      const steps = [...(existing?.steps ?? [])];
      const cards = { ...view.cards };
      for (const step of planned) {
        const key = cardKey(event.plan, step.id);
        if (!steps.includes(key)) steps.push(key);
        // attempt 0 means none yet, so the first real event counts whether the server counts from 0 or 1
        cards[key] ??= { plan: event.plan, step: step.id, run: event.run ?? '', turn: event.turn ?? '', op: step.op, family: step.family, title: step.title, status: 'queued', attempt: 0, notices: [], note: step.note, visual: {} };
      }
      const group: PlanGroup = { plan: event.plan, run: event.run ?? existing?.run ?? '', turn: event.turn ?? existing?.turn ?? '', steps, planned, done: false, ok: null, duration_ms: null };
      return { ...view, cards, plans: { ...view.plans, [event.plan]: group }, planOrder: existing ? view.planOrder : [...view.planOrder, event.plan] };
    }
    case 'plan.completed': {
      const group = event.plan ? view.plans[event.plan] : undefined;
      if (!group) return view;
      return { ...view, plans: { ...view.plans, [group.plan]: { ...group, done: true, ok: payload.ok !== false, duration_ms: typeof payload.duration_ms === 'number' ? payload.duration_ms : null } } };
    }
    case 'proposal.revision': {
      const summary = summaryOf(payload);
      if (!summary.id) return view;
      const base: ProposalState = view.proposal ?? { id: text(payload.proposal), currentId: null, history: [] };
      const known = base.history.find((item) => item.id === summary.id);
      const merged: RevisionSummary = { ...known, ...summary, parent: known?.parent ?? null, created_at: known?.created_at || event.at, title: summary.title || known?.title || '' };
      const history = [...base.history.filter((item) => item.id !== summary.id), merged].sort((a, b) => a.number - b.number);
      let proposal: ProposalState = { ...base, history };
      if (summary.current) proposal = withCurrent(proposal, summary.id);
      return { ...view, proposal, revisionTick: summary.current ? view.revisionTick + 1 : view.revisionTick };
    }
    case 'proposal.current': {
      const id = text(payload.revision);
      if (!id) return view;
      const base: ProposalState = view.proposal ?? { id: text(payload.proposal), currentId: null, history: [] };
      return { ...view, proposal: withCurrent(base, id), revisionTick: view.revisionTick + 1 };
    }
    case 'permission.requested': {
      const asked = payload as unknown as Permission;
      if (!asked?.id) return view;
      return { ...view, permissions: [...view.permissions.filter((item) => item.id !== asked.id), { ...asked, status: asked.status ?? 'pending' }] };
    }
    case 'permission.decided': {
      const id = text(payload.id);
      const status = text(payload.status) as Permission['status'];
      return { ...view, permissions: view.permissions.map((item) => (item.id === id && status ? { ...item, status } : item)) };
    }
    case 'commit.updated': {
      const key = text(payload.key);
      if (!key) return view;
      return { ...view, commits: { ...view.commits, [key]: { status: text(payload.status), draft_id: typeof payload.draft_id === 'number' ? payload.draft_id : null, name: typeof payload.name === 'string' ? payload.name : null } } };
    }
    case 'job.update':
      return { ...view, readinessTick: view.readinessTick + 1 };
    case 'error':
      return { ...view, notes: note(view, event, text(payload.message) || 'Something went wrong while Lucy was working.', 'problem') };
    default:
      return view;
  }
}

/** A revision the page made current itself, by an edit, a restore or choosing an older one. */
function adoptRevision(view: LucyView, revision: Revision): LucyView {
  const base: ProposalState = view.proposal ?? { id: revision.proposal, currentId: null, history: [] };
  const summary: RevisionSummary = {
    id: revision.id, number: revision.number, parent: revision.parent, branch: revision.branch, kind: revision.kind, hash: revision.hash,
    summary: revision.summary, created_at: revision.created_at, songs: revision.snapshot.songs.length, title: revision.snapshot.title,
    ready_only: revision.snapshot.ready_only, current: true,
  };
  const history = [...base.history.filter((item) => item.id !== revision.id), summary].sort((a, b) => a.number - b.number);
  return { ...view, proposal: withCurrent({ ...base, history }, revision.id) };
}

export function reduce(view: LucyView, action: LucyAction): LucyView {
  switch (action.type) {
    case 'reset': return { ...EMPTY_VIEW, revisionTick: view.revisionTick, readinessTick: view.readinessTick };
    case 'snapshot': return fromSnapshot(action.snapshot, view);
    case 'current': return adoptRevision(view, action.revision);
    case 'events': {
      let next = view;
      for (const event of action.events) {
        if (event.id <= next.cursor) continue;
        next = fold(next, event);
      }
      return next;
    }
  }
}

/** A few words about what just happened, for a screen reader. Never one per word of text. */
export function summarize(events: LucyEvent[]): string[] {
  const said: string[] = [];
  const count = (type: string) => events.filter((event) => event.type === type).length;
  if (events.some((event) => event.type === 'message.started' && event.payload?.role === 'assistant')) said.push('Lucy is replying');
  const finished = count('step.completed');
  if (finished) said.push(`${finished} ${finished === 1 ? 'step' : 'steps'} finished`);
  const failed = count('step.failed');
  if (failed) said.push(`${failed} ${failed === 1 ? 'step' : 'steps'} didn’t work`);
  for (const event of events) {
    if (event.type === 'proposal.revision' && event.payload?.current) said.push(`New proposal: revision ${num(event.payload?.number)}`);
    if (event.type === 'permission.requested') said.push('Lucy is asking before it does something');
    if (event.type === 'message.completed' && event.payload?.status === 'complete') said.push('Lucy finished replying');
    if (event.type === 'run.state' && event.payload?.state === 'failed') said.push('Lucy stopped because something went wrong');
    if (event.type === 'error' && typeof event.payload?.message === 'string') said.push(event.payload.message);
  }
  return [...new Set(said)];
}
