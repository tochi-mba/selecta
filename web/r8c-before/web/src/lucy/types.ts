/** Everything Lucy's server says, typed exactly as the contract gives it. Nothing here is computed: the
 * page reads these and says only what they hold. */

export type ProviderKind = 'builtin' | 'anthropic' | 'openai';
export type ProviderMode = 'full' | 'constrained' | 'unavailable';

export type Phases = { chat: boolean; proposals: boolean; commit: boolean; memory: boolean; voice: boolean };
export type PhaseName = keyof Phases;

export type Budgets = {
  max_cycles: number;
  max_steps: number;
  max_seconds: number;
  max_output_tokens: number;
  spend_cap_usd: number | null;
};

export type DataClass = { id: string; label: string; sent: boolean };

export type LucyStatus = {
  enabled: boolean;
  phases: Phases;
  provider: {
    kind: ProviderKind;
    label: string;
    model: string | null;
    base_url: string | null;
    remote: boolean;
    consented: boolean;
    key_set: boolean;
    mode: ProviderMode;
    reason: string | null;
    capabilities: { streaming: boolean; tools: boolean; json_schema: boolean; context_tokens: number | null; cancellation: boolean };
  };
  budgets: Budgets;
  privacy: { share_lyrics: boolean; share_history: boolean; data_classes: DataClass[] };
  event_schema: number;
  api_version: number;
};

export type SettingsChange = {
  enabled?: boolean;
  phases?: Partial<Phases>;
  provider?: { kind?: ProviderKind; model?: string; base_url?: string; api_key?: string; consent?: boolean };
  budgets?: Partial<Budgets>;
  privacy?: Partial<{ share_lyrics: boolean; share_history: boolean }>;
};

export type ScopeKind = 'current' | 'draft';
export type ConversationScope = { kind: ScopeKind; draft?: number; occurrence?: number; seam?: number };

/** Times may come back as ISO text or as epoch numbers, so nothing assumes which. */
export type When = string | number;

export type Conversation = {
  id: string;
  title: string;
  scope: Record<string, unknown>;
  proposal_id: string | null;
  parent_id: string | null;
  branched_from: string | null;
  archived: boolean;
  created_at: When;
  updated_at: When;
  last_user_text: string | null;
};

export type MessageRole = 'user' | 'assistant' | 'notice';
export type MessageStatus = 'streaming' | 'complete' | 'interrupted' | 'cancelled' | 'failed';

export type Message = {
  id: string;
  seq: number;
  role: MessageRole;
  turn: string | null;
  run: string | null;
  content: string;
  status: MessageStatus;
  revision: string | null;
  meta: Record<string, unknown>;
  created_at: When;
};

export type RunState =
  | 'interpreting' | 'running_tools' | 'evaluating' | 'preparing' | 'streaming' | 'awaiting_user'
  | 'awaiting_permission' | 'interrupted' | 'failed' | 'completed' | 'cancelled' | 'superseded';

export type Run = {
  id: string;
  turn: string;
  state: RunState;
  cycles: number;
  steps: number;
  limits: Record<string, number>;
  usage: Record<string, unknown>;
  error: string | null;
};

export type CardStatus = 'queued' | 'running' | 'progress' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'retrying';
export type Family = 'search' | 'analysis' | 'transition' | 'planning' | 'constraints' | 'revision' | 'render' | 'memory' | 'history' | 'other';

export type Progress = { done: number; total: number | null; unit: string };

export type Card = {
  plan: string;
  step: string;
  run: string;
  turn: string;
  op: string;
  family: Family;
  title: string;
  status: CardStatus;
  attempt: number;
  count?: number | null;
  returned?: number | null;
  capped?: boolean;
  notices: string[];
  error?: string | null;
  skipped_because?: string | null;
  duration_ms?: number | null;
  note?: string | null;
  progress?: Progress | null;
  visual: Record<string, unknown>;
};

export type RevisionKind = 'plan' | 'revise' | 'restore' | 'branch' | 'variant';

export type PSong = {
  occurrence: string;
  song_id: number;
  artist: string;
  title: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  energy: number | null;
  locked: boolean;
};

export type ReadyStatus = 'already_rendered' | 'ready' | 'queued' | 'rendering' | 'failed' | 'none';

export type PSeam = {
  a_occ: string;
  b_occ: string;
  a: number;
  b: number;
  key: string;
  settings: Record<string, unknown>;
  requested: string;
  requested_label: string;
  ready: { status: ReadyStatus; rendered: string | null; rendered_label: string | null; verified: boolean };
  evidence: {
    tempo_gap: number | null;
    key_distance: number | null;
    history: 'liked' | 'clean' | 'failed' | 'unknown';
    provenance: 'playable' | 'history_only' | 'predicted' | 'user_rated';
  };
  warnings: string[];
};

export type Rule = {
  id: string;
  kind: string;
  target: string;
  value: unknown;
  strength: 'hard' | 'soft';
  source: string;
  scope: string;
  created_turn: string | null;
  supersedes: string | null;
  status: 'active' | 'superseded' | 'removed';
  text: string;
  label: string;
};

export type DiffCounts = { added: number; removed: number; replaced: number; moved: number; kept: number };

export type Diff = {
  songs: { occurrence: string; song_id: number; status: 'added' | 'replaced' | 'moved' | 'kept' }[];
  removed: { occurrence: string; song_id: number; title: string | null; replaced: boolean }[];
  counts: DiffCounts;
  seams_changed: { a_occ: string; b_occ: string; status: string }[];
  rules_changed: { id: string; status: string }[];
  /** Verified transitions before and after, by directed occurrence pair. Older servers leave it out. */
  readiness?: { before: { ready: number; needed: number }; after: { ready: number; needed: number }; kept: number; lost: number; gained: number };
};

export type LedgerSeam = { a_occ: string; b_occ: string; key: string; status: string; requested: string; rendered: string | null; verified: boolean; proof: string };

export type Ledger = { seams: LedgerSeam[]; ready: number; needed: number; playable_now: boolean; checked_at: string };

export type ProposalSnapshot = {
  title: string;
  ready_only: boolean;
  variant: string;
  songs: PSong[];
  seams: PSeam[];
  constraints: Rule[];
  evaluation: {
    duration: { source_seconds: number; low: number; high: number; exact: boolean };
    energy: (number | null)[];
    warnings: string[];
    objective: Record<string, number>;
  };
  versions: Record<string, unknown>;
  diff?: Diff | null;
  revision: string;
  number: number;
};

export type Revision = {
  id: string;
  proposal: string;
  number: number;
  parent: string | null;
  branch: string;
  kind: RevisionKind;
  hash: string;
  summary: string;
  turn: string | null;
  created_at: When;
  snapshot: ProposalSnapshot;
  ledger?: Ledger;
};

export type RevisionSummary = {
  id: string;
  number: number;
  parent: string | null;
  branch: string;
  kind: RevisionKind;
  hash: string;
  summary: string;
  created_at: When;
  songs: number;
  title: string;
  ready_only: boolean;
  current: boolean;
};

export type Permission = {
  id: string;
  tier: 'compute' | 'save' | 'play';
  operation: string;
  arguments: Record<string, unknown>;
  text: string;
  status: 'pending' | 'allowed' | 'denied';
  run: string | null;
};

export type Snapshot = {
  conversation: Conversation;
  messages: Message[];
  proposal: { id: string; current: Revision | null; history: RevisionSummary[] } | null;
  run: Run | null;
  permissions: Permission[];
  cards: Card[];
  cursor: number;
  event_schema: number;
};

export type Selection = { occurrence?: string; seam?: [string, string] };

export type TurnBody = { client_id: string; text: string; expected_revision: string | null; selection?: Selection };
export type TurnAccepted = { turn: { id: string; seq: number; status: string }; new: boolean; run: string | null };

export type LucyEvent = {
  id: number;
  v: number;
  type: string;
  conversation: string;
  turn: string | null;
  run: string | null;
  plan: string | null;
  step: string | null;
  /** Its shape depends on `type`; the reducer reads each one defensively. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  at: string;
};

export type EventsPage = { events: LucyEvent[]; gap: boolean; cursor: number };

export type EditOp = { op: 'lock' | 'unlock' | 'remove' | 'move'; occurrence: string; to?: number };

export type ApproveAction = 'draft' | 'draft_and_play';

export type Approval = {
  token: string;
  expires_at: number;
  action: ApproveAction;
  preflight: { ok: boolean; problems: string[]; songs: number; ready: number; needed: number; ready_only: boolean; title: string };
};

export type Commit = {
  key: string;
  status: 'committed' | 'failed' | 'pending';
  draft_id: number | null;
  name: string | null;
  played: boolean;
  repeat: boolean;
  problems?: string[];
};

export type MemoryKind = 'explicit' | 'inferred' | 'session';

export type MemoryFact = {
  id: string;
  kind: MemoryKind;
  subject: string;
  value: unknown;
  label: string;
  source: Record<string, unknown>;
  confidence: number | null;
  conversation_id: string | null;
  updated_at: string;
};

export type Memory = {
  facts: MemoryFact[];
  history: {
    enabled: boolean;
    events: number;
    top: { song_id: number; title: string; artist: string; plays: number; completes: number; skips: number }[];
    period: string | null;
  };
  provider_receives: string[];
};

export type ListeningEventKind = 'start' | 'complete' | 'skip';
