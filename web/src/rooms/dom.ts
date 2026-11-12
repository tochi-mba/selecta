// A few lines of DOM building for the guest and display pages, which stay tiny by not using
// React. Text always goes in as text, never as HTML: song titles and room names come from people.

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | ((event: Event) => void) | undefined>;

export function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (key === 'className') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function replace(target: Element, ...children: Child[]): void {
  target.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

export type Song = { song_id: number; title: string; artist: string; length_s: number };

export function songLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function songLine(song: Song | null): string {
  return song ? `${song.title} - ${song.artist}` : 'A song';
}

export const apiOrigin = ((import.meta.env.VITE_SELECTA_API_ORIGIN as string | undefined) ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter?: number) {
    super(message);
  }
}

/** Fetch JSON from the API with cookies; refusals become `ApiError` with the server's words. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${path}`, {
      ...init,
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach SelectaDJ. Check your signal.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (body.detail && typeof body.detail === 'object' ? body.detail : body) as { code?: string; message?: string; retry_after_s?: number };
    throw new ApiError(response.status, detail.code ?? 'error', detail.message ?? (typeof body.detail === 'string' ? body.detail : 'Something went wrong. Try again.'), detail.retry_after_s);
  }
  return body as T;
}

export function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the page still works, it just forgets */ }
  return null;
}
