// A small in-memory IndexedDB for tests (jsdom has none). It models only what the media store,
// the folder store and the device-data wipe use: named databases, object stores with a keyPath
// or explicit keys, put/get/delete/getAll in a transaction that completes on the next tick,
// deleteDatabase (firing versionchange on open connections) and databases().

type Rows = Map<IDBValidKey, unknown>;
type Database = { version: number; stores: Map<string, { keyPath: string | null; rows: Rows }>; connections: Set<FakeConnection> };

type Request<T> = { result: T; error: DOMException | null; onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked?: (() => void) | null; onupgradeneeded?: (() => void) | null };

const tick = (run: () => void) => setTimeout(run, 0);

class FakeConnection {
  onversionchange: (() => void) | null = null;
  closed = false;
  constructor(readonly name: string, private readonly db: Database) {}
  get objectStoreNames() {
    const names = [...this.db.stores.keys()];
    return { contains: (name: string) => names.includes(name), length: names.length };
  }
  createObjectStore(name: string, options?: { keyPath?: string }) {
    this.db.stores.set(name, { keyPath: options?.keyPath ?? null, rows: new Map() });
  }
  close() {
    this.closed = true;
    this.db.connections.delete(this);
  }
  transaction(name: string) {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError');
    const store = this.db.stores.get(name);
    if (!store) throw new DOMException('no store', 'NotFoundError');
    const transaction = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null,
      objectStore: () => {
        const request = <T,>(run: () => T): Request<T> => {
          const made: Request<T> = { result: undefined as T, error: null, onsuccess: null, onerror: null };
          tick(() => {
            made.result = run();
            made.onsuccess?.();
            tick(() => transaction.oncomplete?.());
          });
          return made;
        };
        return {
          put: (value: unknown, key?: IDBValidKey) => request(() => {
            const id = key ?? (store.keyPath ? (value as Record<string, IDBValidKey>)[store.keyPath] : undefined);
            store.rows.set(id as IDBValidKey, value);
            return id;
          }),
          get: (key: IDBValidKey) => request(() => store.rows.get(key)),
          delete: (key: IDBValidKey) => request(() => { store.rows.delete(key); return undefined; }),
          getAll: () => request(() => [...store.rows.values()]),
          clear: () => request(() => { store.rows.clear(); return undefined; }),
        };
      },
    };
    return transaction;
  }
}

export type FakeIndexedDb = IDBFactory & { names: () => string[]; rows: (db: string, store: string) => unknown[] };

export function fakeIndexedDb(): FakeIndexedDb {
  const databases = new Map<string, Database>();
  const factory = {
    open(name: string, version = 1) {
      const made: Request<FakeConnection | null> = { result: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      tick(() => {
        let db = databases.get(name);
        const fresh = !db;
        if (!db) {
          db = { version, stores: new Map(), connections: new Set() };
          databases.set(name, db);
        }
        const connection = new FakeConnection(name, db);
        db.connections.add(connection);
        made.result = connection;
        if (fresh) made.onupgradeneeded?.();
        made.onsuccess?.();
      });
      return made;
    },
    deleteDatabase(name: string) {
      const made: Request<undefined> = { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null };
      tick(() => {
        const db = databases.get(name);
        for (const connection of [...(db?.connections ?? [])]) connection.onversionchange?.();
        databases.delete(name);
        made.onsuccess?.();
      });
      return made;
    },
    databases: async () => [...databases.keys()].map((name) => ({ name, version: databases.get(name)!.version })),
    names: () => [...databases.keys()].sort(),
    rows: (db: string, store: string) => [...(databases.get(db)?.stores.get(store)?.rows.values() ?? [])],
  };
  return factory as unknown as FakeIndexedDb;
}
