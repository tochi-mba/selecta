// A few lines of DOM building for the guest and display pages, which stay tiny by not using
// React. Text always goes in as text, never as HTML: song titles and room names come from people.

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | ((event: Event) => void) | undefined>;
type Handlers = Record<string, (event: Event) => void>;
type Handled = Element & { _on?: Handlers };

function listen(node: Handled, type: string, handler: (event: Event) => void): void {
  if (!node._on) node._on = {};
  // one listener per type reads the current handler, so a patched node runs the newest one
  if (!node._on[type]) node.addEventListener(type, (event) => node._on?.[type]?.(event));
  node._on[type] = handler;
}

export function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') listen(node, key.replace(/^on/, '').toLowerCase(), value);
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

const keyOf = (node: Node): string | null => (node instanceof Element ? node.getAttribute('data-key') ?? node.id ?? null : null) || null;
const sameKind = (a: Node, b: Node) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

/** Like `replace`, but keeps the nodes that are still there: a child with the same `data-key` (or
 * id), or else the same tag in the same place, is updated in place rather than swapped. A poll
 * redrawing a list therefore never takes focus from the button a guest is on. */
export function patch(target: Element, ...children: Child[]): void {
  const focused = document.activeElement;
  const next = children
    .filter((c): c is Node | string => c !== null && c !== undefined && c !== false)
    .map((c) => (typeof c === 'string' ? document.createTextNode(c) : c));
  const old = Array.from(target.childNodes);
  const keyed = new Map<string, Node>();
  for (const node of old) { const key = keyOf(node); if (key) keyed.set(key, node); }
  const used = new Set<Node>();
  const result = next.map((fresh, index) => {
    const key = keyOf(fresh);
    const candidate = key ? keyed.get(key) : old[index];
    if (!candidate || used.has(candidate) || !sameKind(candidate, fresh) || (!key && keyOf(candidate))) return fresh;
    used.add(candidate);
    update(candidate, fresh);
    return candidate;
  });
  for (const node of old) if (!used.has(node)) node.remove();
  // kept nodes are already in order relative to each other; only new ones are inserted
  result.forEach((node, index) => { if (target.childNodes[index] !== node) target.insertBefore(node, target.childNodes[index] ?? null); });
  // a kept button moved by a reorder (votes change the order) is focused again where it now is
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
}

function update(current: Node, fresh: Node): void {
  if (!(current instanceof Element) || !(fresh instanceof Element)) {
    if (current.nodeValue !== fresh.nodeValue) current.nodeValue = fresh.nodeValue;
    return;
  }
  for (const { name } of Array.from(current.attributes)) if (!fresh.hasAttribute(name)) current.removeAttribute(name);
  for (const { name, value } of Array.from(fresh.attributes)) if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  const freshOn = (fresh as Handled)._on ?? {};
  // a handler the fresh node does not declare is dropped, so a stale onclick never survives a patch
  const kept = (current as Handled)._on;
  if (kept) for (const type of Object.keys(kept)) if (!(type in freshOn)) delete kept[type];
  for (const [type, handler] of Object.entries(freshOn)) listen(current as Handled, type, handler);
  patch(current, ...Array.from(fresh.childNodes));
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
