import type { RegisteredSong, Request, SongRegistration } from './importer';
import type { DirectoryHandleLike, FileHandleLike } from './store';

// Small shims for the media tests: files, handles, directories and a capturing request. Kept
// out of the test files so every suite fakes the same things the same way. Not part of the
// public surface; nothing outside *.test.ts should import this.

export function bytesFile(content: string | Uint8Array, name: string): File {
  return new File([content as BlobPart], name, { type: 'audio/mpeg' });
}

export type FakeHandleState = { permission: string; broken: boolean };

export type FakeHandle = FileHandleLike & { state: FakeHandleState };

/** A file handle whose permission and health the test can flip mid-flight. `requestPermission`
 * grants when the state is 'prompt', mirroring a person tapping Allow. */
export function fakeHandle(file: File, state: Partial<FakeHandleState> = {}): FakeHandle {
  const handle: FakeHandle = {
    kind: 'file',
    name: file.name,
    state: { permission: state.permission ?? 'granted', broken: state.broken ?? false },
    getFile: async () => {
      if (handle.state.broken) throw new DOMException('The file is gone.', 'NotFoundError');
      if (handle.state.permission !== 'granted') throw new DOMException('Permission lapsed.', 'NotAllowedError');
      return file;
    },
    queryPermission: async () => handle.state.permission,
    requestPermission: async () => {
      if (handle.state.permission === 'prompt') handle.state.permission = 'granted';
      return handle.state.permission;
    },
  };
  return handle;
}

export function fakeDirectory(name: string, entries: (FileHandleLike | DirectoryHandleLike)[]): DirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    values: () => (async function* () {
      for (const entry of entries) yield entry;
    })(),
  };
}

export type CapturedCall = { path: string; method: string; body?: unknown; headers?: HeadersInit };

export type CaptureOptions = {
  /** Mark a registration as a likely duplicate by its title: title -> duplicate_of id. */
  duplicates?: Record<string, number>;
  /** Replace the answer for a path entirely (to fake failures, odd replies). */
  respond?: (path: string, body: unknown) => unknown;
};

/** A fake of the injected request function implementing the local-media server contract:
 * registrations get incrementing song ids (the same hash keeps its first id), availability
 * acknowledges. Every call is captured with its parsed body. */
export function captureRequest(options: CaptureOptions = {}): { request: Request; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const known = new Map<string, number>();
  let nextId = 1;
  const request = (async (path: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ path, method: init?.method ?? 'GET', body, headers: init?.headers });
    if (options.respond) return options.respond(path, body);
    if (path === '/api/local-media/songs' && init?.method === 'POST') {
      const { songs } = body as { songs: SongRegistration[] };
      const registered: RegisteredSong[] = songs.map((song) => {
        let song_id = known.get(song.content_sha256);
        if (song_id === undefined) {
          song_id = nextId;
          nextId += 1;
          known.set(song.content_sha256, song_id);
        }
        const duplicate_of = options.duplicates?.[song.title];
        return duplicate_of === undefined ? { song_id, content_sha256: song.content_sha256 } : { song_id, content_sha256: song.content_sha256, duplicate_of };
      });
      return { songs: registered };
    }
    if (path === '/api/local-media/availability' && init?.method === 'POST') return {};
    // the library's remove (a soft delete on the server) answers with nothing
    if (/^\/api\/local-media\/songs\/\d+$/.test(path) && init?.method === 'DELETE') return {};
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
  }) as Request;
  return { request, calls };
}
