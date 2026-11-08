import { get, send } from '../api';
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

function change<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return send<T>(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-operation-id': newId() },
    body: method === 'DELETE' && body === undefined ? undefined : JSON.stringify(body ?? {}),
  });
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

  sendTurn: (id: string, body: TurnBody) => change<TurnAccepted>('POST', `/lucy/conversations/${at(id)}/turns`, body),
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

  decide: (id: string, decision: 'allow' | 'deny') => change<Permission>('POST', `/lucy/permissions/${at(id)}`, { decision }),

  memory: () => get<Memory>('/lucy/memory'),
  remember: (subject: string, value: unknown) => change<MemoryFact>('POST', '/lucy/memory', { subject, value }),
  editFact: (id: string, value: unknown) => change<MemoryFact>('PATCH', `/lucy/memory/${at(id)}`, { value }),
  forget: (id: string) => change<{ forgotten: true }>('DELETE', `/lucy/memory/${at(id)}`),
  clearMemory: (kind: Exclude<MemoryKind, 'session'> | 'history') => change<{ cleared: number }>('POST', '/lucy/memory/clear', { kind }),
};
