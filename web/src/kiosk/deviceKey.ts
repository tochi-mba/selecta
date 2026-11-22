// The kiosk's device key and machine id (ADR-0445). At pairing the page makes a non-extractable
// ECDSA P-256 key pair with WebCrypto and keeps it in IndexedDB; only the public half ever leaves
// the device. Every heartbeat signs the server's nonce with it, so a copied sign-in cookie on
// another machine is refused. The machine id is a random id made at first launch, never a
// hardware id. If IndexedDB is unavailable the key lives for this page only, and the player
// pairs again after a restart (the setup guide asks for persistent storage).

export const SIGNED_PREFIX = 'selecta-kiosk-heartbeat:';
const DB_NAME = 'selectadj-kiosk';
const STORE = 'device';

export type DeviceRecord = { keys: CryptoKeyPair; publicKey: string; machineId: string };

export type KeyStore = {
  get(): Promise<DeviceRecord | null>;
  put(record: DeviceRecord): Promise<void>;
  clear(): Promise<void>;
};

export function memoryKeyStore(): KeyStore {
  let held: DeviceRecord | null = null;
  return {
    get: async () => held,
    put: async (record) => { held = record; },
    clear: async () => { held = null; },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB when it opens (CryptoKey objects are stored as they are), memory otherwise. */
export async function openKeyStore(factory: IDBFactory | null | undefined = globalThis.indexedDB): Promise<KeyStore> {
  if (!factory) return memoryKeyStore();
  let db: IDBDatabase;
  try {
    const open = factory.open(DB_NAME, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
    db = await request(open);
  } catch {
    return memoryKeyStore();
  }
  const fallback = memoryKeyStore();
  const run = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    request(fn(db.transaction(STORE, mode).objectStore(STORE)));
  return {
    async get() {
      try { return ((await run('readonly', (s) => s.get('record'))) as DeviceRecord | undefined) ?? null; } catch { return fallback.get(); }
    },
    async put(record) {
      try { await run('readwrite', (s) => s.put(record, 'record')); } catch { await fallback.put(record); }
    },
    async clear() {
      try { await run('readwrite', (s) => s.delete('record')); } catch { /* nothing kept */ }
      await fallback.clear();
    },
  };
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export type DeviceKey = {
  publicKey: string;
  machineId: string;
  sign(nonce: string): Promise<string>;
  /** Forget the key and machine id (after an unpair or replace); the next pairing makes new ones. */
  forget(): Promise<void>;
};

/** The stored key, or a new non-extractable one. */
export async function deviceKey(store: KeyStore, subtle: SubtleCrypto = crypto.subtle): Promise<DeviceKey> {
  let record = await store.get();
  if (!record) {
    const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const spki = await subtle.exportKey('spki', keys.publicKey);
    record = { keys, publicKey: base64url(spki), machineId: randomId() };
    await store.put(record);
  }
  const held = record;
  return {
    publicKey: held.publicKey,
    machineId: held.machineId,
    async sign(nonce: string) {
      const data = new TextEncoder().encode(`${SIGNED_PREFIX}${nonce}`);
      const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, held.keys.privateKey, data);
      return base64url(signature);
    },
    async forget() {
      await store.clear();
    },
  };
}
