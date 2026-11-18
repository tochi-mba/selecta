import { createContext, useContext } from 'react';
import { Client, clientFor, fetchBytes, Request, request as localRequest } from './api';

/** The injected request layer (ADR-0462) for parts of a page that do not receive ViewProps.
 *
 * Local mode never provides it, so every view keeps the relative `/api` client exactly as before.
 * The local-first Cloud shell provides its adapted, authenticated client once, at the top, and
 * every nested panel (song details, drafts, the mix setup sheet) then asks the same server the
 * page does. A view never imports get/post/del itself; importBoundaries.test.ts holds it to that.
 */
export const RequestContext = createContext<Request>(localRequest);

/** The request this part of the page should use: an explicit one wins over the provided one. */
export function useRequest(override?: Request): Request {
  const provided = useContext(RequestContext);
  return override ?? provided;
}

/** get/post/del over this page's request, stable for as long as the request is. */
export function useApi(override?: Request): Client {
  return clientFor(useRequest(override));
}

/** Raw bytes (backups, seam clips) the JSON request does not carry. Callers check `ok` themselves. */
export type BytesRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** Local mode reads bytes from its own `/api`; a shell with no such server provides another
 * source (or a plain refusal) once, at the top, exactly as it provides the JSON request. */
export const BytesContext = createContext<BytesRequest>(fetchBytes);

/** Where this part of the page reads raw bytes from. */
export function useBytes(): BytesRequest {
  return useContext(BytesContext);
}

/** A byte source for a shell with no local server: every ask gets a plain refusal, which every
 * caller already renders as "not available here" rather than a network error. */
export const noBytesHere: BytesRequest = async () => new Response(
  JSON.stringify({ detail: 'SelectaDJ can’t do that in your browser yet.', code: 'flag_off' }),
  { status: 404, headers: { 'content-type': 'application/json' } },
);
