/** Explicit same-origin client for the loopback-only Cloud development watch manager.
 * This never contacts the hosted API or transports media / filesystem paths to Cloud. */
export async function localWatchRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith('/dev/local-watches') || path.startsWith('//')) {
    throw new Error('Only local watch management endpoints are permitted.');
  }
  const response = await fetch(path, {
    ...init,
    headers: {
      'X-Selecta-Local-Watch': '1',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'same-origin',
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail: unknown }).detail : undefined;
    throw new Error(typeof reason === 'string' ? reason : 'The local source manager did not accept this request.');
  }
  if (payload === null) throw new Error('The local source manager is not available.');
  return payload as T;
}
