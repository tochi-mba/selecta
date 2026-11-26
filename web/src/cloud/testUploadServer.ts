import { CloudError, type Api } from './api';

// A fake of the upload routes for the upload queue's tests (`cloud.move_to_cloud`): preview,
// plan, the sessions, the presigned part PUTs and completion, with every request captured. Its
// sessions keep the parts they were sent, so a queue carried on after a reload is seen to skip
// what already went.

export type ServerCall = { method: string; path: string; body: unknown };
export type PutCall = { url: string; size: number };

export type FakeSession = {
  id: string; songId: number | null; size: number; sha: string; partSize: number; partCount: number;
  parts: Set<number>; status: string; expiresAt: number;
};

export type FakeServerOptions = {
  /** Songs already in the cloud library (the preview says so). */
  inCloud?: ReadonlySet<number>;
  /** The preview refuses these songs, with this reason. */
  refuse?: ReadonlyMap<number, string>;
  /** Bytes left in the cloud library; unlimited when left out. */
  room?: number;
  /** The song id acceptance answers with; the named song by default. */
  acceptAs?: (songId: number | null) => number | undefined;
  /** Completion rejects these songs, with this code. */
  reject?: ReadonlyMap<number, string>;
  /** Part size in bytes. */
  partSize?: number;
  /** A route answers with this error instead (the grant revoked, say). */
  fail?: (method: string, path: string) => CloudError | null;
  /** A part PUT fails (the connection dropped). */
  failPut?: (url: string, attempt: number) => boolean;
  /** How long a part PUT takes, in ms. */
  putDelay?: number;
  /** Seconds a plan's hold lasts, asked per plan; two days by default. */
  holdSeconds?: () => number;
};

export function fakeUploadServer(options: FakeServerOptions = {}) {
  const calls: ServerCall[] = [];
  const puts: PutCall[] = [];
  const sessions = new Map<string, FakeSession>();
  let made = 0;
  let room = options.room ?? Number.POSITIVE_INFINITY;
  let inFlight = 0;
  let mostInFlight = 0;
  let putAttempts = 0;
  const partSize = options.partSize ?? 4;

  const sessionJson = (session: FakeSession) => ({
    id: session.id, name: 'x', size: session.size, sha256: session.sha, part_size: session.partSize, part_count: session.partCount,
    status: session.status, expires_at: session.expiresAt, ...(session.songId !== null ? { song_id: session.songId } : {}),
  });

  const api = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    calls.push({ method, path, body });
    const failed = options.fail?.(method, path);
    if (failed) throw failed;
    if (method === 'GET' && path === '/uploads') {
      return { uploads: [...sessions.values()].filter((one) => one.status === 'planned' || one.status === 'uploading').map(sessionJson) };
    }
    if (method === 'POST' && path === '/uploads/preview') {
      const files = (body as { files: { size: number; song_id: number }[] }).files;
      let left = room;
      let full = false;
      return {
        files: files.map((file, index) => {
          const base = { index, name: 'x', song_id: file.song_id, reason: null as string | null, notes: [] };
          if (options.inCloud?.has(file.song_id)) return { ...base, status: 'in_cloud_library' };
          const refused = options.refuse?.get(file.song_id);
          if (refused) return { ...base, status: 'refused', reason: refused };
          if (full || file.size > left) { full = true; return { ...base, status: 'refused', reason: 'quota' }; }
          left -= file.size;
          return { ...base, status: 'ok' };
        }),
        totals: {},
      };
    }
    if (method === 'POST' && path === '/uploads/plan') {
      const files = (body as { files: { size: number; sha256: string; song_id: number }[] }).files;
      return {
        uploads: files.map((file, index) => {
          if (file.size > room) return { index, name: 'x', refused: 'Your cloud library is full.', duplicate_of: null, same_as: null, session: null };
          room -= file.size;
          made += 1;
          const session: FakeSession = {
            id: `s${made}`, songId: file.song_id ?? null, size: file.size, sha: file.sha256, partSize,
            partCount: Math.max(1, Math.ceil(file.size / partSize)), parts: new Set(), status: 'planned', expiresAt: Date.now() / 1000 + (options.holdSeconds?.() ?? 2 * 24 * 3600),
          };
          sessions.set(session.id, session);
          return { index, name: 'x', refused: null, duplicate_of: null, same_as: null, session: sessionJson(session) };
        }),
      };
    }
    const one = /^\/uploads\/([^/]+)(\/parts|\/complete)?$/.exec(path);
    const session = one ? sessions.get(decodeURIComponent(one[1])) : undefined;
    if (one && !session) throw new CloudError('Not found.', 404, 'upload_not_found');
    if (session && method === 'GET' && !one![2]) {
      if (session.status === 'planned') session.status = 'uploading';
      return { upload: { ...sessionJson(session), error: null }, uploaded_parts: [...session.parts].map((number) => ({ number, etag: 'e', size: 1 })) };
    }
    if (session && method === 'POST' && one![2] === '/parts') {
      const numbers = (body as { part_numbers: number[] }).part_numbers;
      return { part_urls: Object.fromEntries(numbers.map((number) => [String(number), `https://r2.test/put/${session.id}/${number}`])) };
    }
    if (session && method === 'POST' && one![2] === '/complete') {
      if (session.parts.size < session.partCount) throw new CloudError('Parts are missing.', 409, 'invalid_state');
      const rejected = session.songId !== null ? options.reject?.get(session.songId) : undefined;
      if (rejected) {
        session.status = 'rejected';
        return { upload: sessionJson(session), asset_id: null, status: 'rejected', error: 'Not accepted.', rejection_code: rejected };
      }
      session.status = 'accepted';
      const songId = options.acceptAs ? options.acceptAs(session.songId) : session.songId ?? undefined;
      return { upload: { ...sessionJson(session), ...(songId !== undefined ? { song_id: songId } : { song_id: undefined }) }, asset_id: `a-${session.id}`, status: 'accepted', error: null };
    }
    if (session && method === 'DELETE') {
      session.status = 'cancelled';
      return { upload: sessionJson(session), asset_id: null, status: 'cancelled', error: null };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as Api;

  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url);
    putAttempts += 1;
    const part = /^https:\/\/r2\.test\/put\/([^/]+)\/(\d+)$/.exec(text);
    if (!part || init?.method !== 'PUT') throw new Error(`unexpected fetch ${init?.method} ${text}`);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    try {
      if (options.putDelay) await new Promise((resolve) => setTimeout(resolve, options.putDelay));
      if (init.signal?.aborted) throw new DOMException('Stopped.', 'AbortError');
      if (options.failPut?.(text, putAttempts)) throw new TypeError('Failed to fetch');
      const size = init.body instanceof Blob ? init.body.size : 0;
      puts.push({ url: text, size });
      sessions.get(part[1])?.parts.add(Number(part[2]));
      return new Response(null, { status: 200 });
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;

  return {
    api, fetchImpl, calls, puts, sessions,
    mostInFlight: () => mostInFlight,
    resetMost: () => { mostInFlight = 0; },
    setRoom: (bytes: number) => { room = bytes; },
    routes: () => calls.map((call) => `${call.method} ${call.path.replace(/\/s\d+/, '/{id}')}`),
  };
}
