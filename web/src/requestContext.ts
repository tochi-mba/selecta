import { createContext, useContext } from 'react';
import { Client, clientFor, Request, request as localRequest } from './api';

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
