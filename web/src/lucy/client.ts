import { ApiError, get as localGet, send, type Request } from '../api';
import type {
  Approval, ApproveAction, Commit, Conversation, ConversationScope, Diff, EditOp, EventsPage, Ledger, LucyStatus,
  Memory, MemoryFact, MemoryKind, Permission, Revision, SettingsChange, Snapshot, TurnAccepted, TurnBody,
} from './types';

/** Every Lucy address, typed. Errors come back as the app's own ApiError, so a page can tell a stale
 * proposal (409 `stale_revision`) from Lucy being off (403 `lucy_off`) from a stopped server. Every
 * change is named with its own `x-operation-id`. */

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const at = (id: string) => encodeURIComponent(id);

/** Where Lucy's requests go. Local mode asks this computer's server at `/api/lucy`; browser-first
 * Cloud (ADR-0476) installs its authenticated request and its own prefix, and reads events by
 * asking every `pollMs` (a bearer token can't ride on an EventSource). */
export type LucyTransport = {
  request: Request; base: string; pollMs: number;
  /** The device this page runs on, sent with each message so Lucy knows what "here" means. */
  device?: () => string | null;
};
let transport: LucyTransport | null = null;

export function setLucyTransport(next: LucyTransport | null): void {
  transport = next;
}

export function lucyTransport(): LucyTransport | null {
  return transport;
}

/** `/lucy/...` as the active transport names it. */
function where(path: string): string {
  return transport ? path.replace(/^\/lucy(?=\/|$)/, transport.base) : path;
}

/** A refusal from the transport's own client (Cloud's `CloudError`) as the app's `ApiError`, so
 * the page tells "Lucy is answering" (409 busy) or a stale save from a dropped connection. */
async function viaTransport<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await transport!.request<T>(where(path), init);
  } catch (error) {
    const refusal = error as { message?: string; status?: unknown; code?: unknown };
    if (!(error instanceof ApiError) && typeof refusal?.status === 'number' && refusal.status > 0) {
      throw new ApiError(String(refusal.message ?? ''), refusal.status, typeof refusal.code === 'string' ? refusal.code : '');
    }
    throw error;
  }
}

function get<T>(path: string): Promise<T> {
  return transport ? viaTransport<T>(path) : localGet<T>(path);
}

function change<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init = {
    method,
    headers: { 'content-type': 'application/json', 'x-operation-id': newId() },
    body: method === 'DELETE' && body === undefined ? undefined : JSON.stringify(body ?? {}),
  };
  return transport ? viaTransport<T>(path, init) : send<T>(path, init);
}

export const lucy = {
  status: () => get<LucyStatus>('/lucy/status'),
  saveSettings: (body: SettingsChange) => change<LucyStatus>('PUT', '/lucy/settings', body),

  conversations: (q: string, archived: boolean) => {
    const query = new URLSearchParams({ archived: archived ? '1' : '0' });
    if (q.trim()) query.set('q', q.trim());
    return get<{ conversations: Conversation[] }>(`/lucy/conversations?${query.toString()}`);
  },
  createConversation: (body: { title?: string; scope?: ConversationScope }) => change<Conversation>('POST', '/lucy/conversations', body),
  conversation: (id: string) => get<Snapshot>(`/lucy/conversations/${at(id)}`),
  updateConversation: (id: string, body: { title?: string; archived?: boolean }) => change<Conversation>('PATCH', `/lucy/conversations/${at(id)}`, body),
  deleteConversation: (id: string) => change<{ deleted: boolean; drafts_kept: true }>('DELETE', `/lucy/conversations/${at(id)}`),
  branchConversation: (id: string, message: string) => change<Conversation>('POST', `/lucy/conversations/${at(id)}/branch`, { message }),

  sendTurn: (id: string, body: TurnBody) => {
    const device = transport?.device?.() ?? null;
    return change<TurnAccepted>('POST', `/lucy/conversations/${at(id)}/turns`, device ? { ...body, device_id: device } : body);
  },
  stop: (id: string) => change<{ stopped: boolean }>('POST', `/lucy/conversations/${at(id)}/stop`, {}),
  retry: (id: string, turn: string) => change<TurnAccepted>('POST', `/lucy/conversations/${at(id)}/retry`, { turn }),
  events: (id: string, after: number) => get<EventsPage>(`/lucy/conversations/${at(id)}/events.json?after=${after}`),

  revision: (id: string) => get<Revision>(`/lucy/revisions/${at(id)}`),
  diff: (id: string, against: string) => get<Diff>(`/lucy/revisions/${at(id)}/diff?against=${at(against)}`),
  readiness: (id: string) => get<Ledger>(`/lucy/revisions/${at(id)}/readiness`),
  makeCurrent: (proposal: string, revision: string, expected: string | null) =>
    change<Revision>('POST', `/lucy/proposals/${at(proposal)}/current`, { revision, expected }),
  restore: (id: string, expected: string | null) => change<Revision>('POST', `/lucy/revisions/${at(id)}/restore`, { expected }),
  branchRevision: (id: string, expected: string | null) => change<Revision>('POST', `/lucy/revisions/${at(id)}/branch`, { expected }),
  edit: (id: string, expected: string, op: EditOp) => change<Revision>('POST', `/lucy/revisions/${at(id)}/edit`, { expected, op }),
  removeRule: (id: string, rule: string, expected: string) =>
    change<Revision>('POST', `/lucy/revisions/${at(id)}/rules/${at(rule)}/remove`, { expected }),

  approve: (body: { revision: string; hash: string; action: ApproveAction }) => change<Approval>('POST', '/lucy/approvals', body),
  commit: (body: { token: string; idempotency_key: string; confirm_play?: boolean }) => change<Commit>('POST', '/lucy/commits', body),
  commitResult: (key: string) => get<Commit>(`/lucy/commits/${at(key)}`),

  /** Cloud (ADR-0476): was this answer useful? Kept for Lucy's evaluation. */
  rate: (message: string, rating: 'up' | 'down') => change<{ rating: string }>('POST', `/lucy/messages/${at(message)}/rating`, { rating }),
  decide: (id: string, decision: 'allow' | 'deny') => change<Permission>('POST', `/lucy/permissions/${at(id)}`, { decision }),

  memory: () => get<Memory>('/lucy/memory'),
  remember: (subject: string, value: unknown) => change<MemoryFact>('POST', '/lucy/memory', { subject, value }),
  editFact: (id: string, value: unknown) => change<MemoryFact>('PATCH', `/lucy/memory/${at(id)}`, { value }),
  forget: (id: string) => change<{ forgotten: true }>('DELETE', `/lucy/memory/${at(id)}`),
  clearMemory: (kind: Exclude<MemoryKind, 'session'> | 'history') => change<{ cleared: number }>('POST', '/lucy/memory/clear', { kind }),
};
