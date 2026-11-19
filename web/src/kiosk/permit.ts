// The kiosk's side of the signed offline bundle (ADR-0446 BZ-0446-05, BZ-0446-06). The server
// signs the exact JSON text with Ed25519 (src/selecta/business/permits.py); the player verifies
// those bytes with a key it trusts before parsing them, and refuses a forged bundle or one older
// than the one it holds. Trusted keys: any baked into the build (VITE_SELECTA_PERMIT_KEYS), the
// keys handed over once at pairing, and the next keys listed inside a bundle it already verified
// (rotation with overlap). `mayPlay` is the same rule as `permits.may_play` on the server, and
// both run the shared vectors in permitVectors.json.

export type Permit = {
  organisation_id: string;
  venue_id: string | null;
  zone_id: string;
  device_id: string;
  plan_state: string;
  stop_at: number | null;
  /** Why `stop_at` is set: a pilot end or a payment grace (ADR-0447). */
  stop_reason?: 'pilot_end' | 'payment' | null;
  licence_expires_at: number | null;
  licence_grace_ends_at: number | null;
  issued_at: number;
  valid_until: number;
};

export type Bundle = {
  v: number;
  time_zone: string | null;
  periods: { opens_at: number; closes_at: number }[];
  programme_version: string | null;
  volume: number | null;
  /** The zone's content policy offline: its version and the programme songs it refuses now. */
  content?: { version: number | null; refused_song_ids: number[]; unavailable?: boolean };
  permit: Permit;
  keys: { key_id: string; public_key: string }[];
};

export type SignedBundle = { bundle: string; signature: string; key_id?: string };
export type Verdict =
  | { ok: true; bundle: Bundle }
  | { ok: false; reason: 'forged' | 'older' | 'unsupported' };

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Verify the exact bytes against each trusted key; parse only after one verifies. */
export async function verifyBundle(
  signed: SignedBundle,
  trusted: readonly string[],
  heldIssuedAt: number | null,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<Verdict> {
  if (!subtle) return { ok: false, reason: 'unsupported' };
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromB64url(signed.signature);
  } catch {
    return { ok: false, reason: 'forged' };
  }
  const data = new TextEncoder().encode(signed.bundle);
  let supported = false;
  for (const key of trusted) {
    let imported: CryptoKey;
    try {
      imported = await subtle.importKey('raw', fromB64url(key), { name: 'Ed25519' }, false, ['verify']);
      supported = true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotSupportedError') continue;
      supported = true;
      continue; // a malformed trusted key never verifies anything
    }
    if (await subtle.verify({ name: 'Ed25519' }, imported, signature, data).catch(() => false)) {
      const bundle = JSON.parse(signed.bundle) as Bundle;
      if (heldIssuedAt !== null && bundle.permit.issued_at < heldIssuedAt) return { ok: false, reason: 'older' };
      return { ok: true, bundle };
    }
  }
  return { ok: false, reason: supported || !trusted.length ? 'forged' : 'unsupported' };
}

/** Same rule as `permits.may_play`: inside `valid_until`, or past it only to the end of the open
 * period already playing; never past a stop instant or the licence grace. */
export function mayPlay(permit: Permit, now: number, openPeriodClose: number | null): boolean {
  if (permit.stop_at !== null && now >= permit.stop_at) return false;
  if (permit.licence_grace_ends_at !== null && now >= permit.licence_grace_ends_at) return false;
  if (now <= permit.valid_until) return true;
  return openPeriodClose !== null && now < openPeriodClose;
}

const KEYS = 'selectadj-kiosk-permit-keys';
const HELD = 'selectadj-kiosk-permit';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const buildKeys = (): string[] =>
  String((import.meta.env?.VITE_SELECTA_PERMIT_KEYS as string | undefined) ?? '').split(',').map((k) => k.trim()).filter(Boolean);

/** The trusted keys and the held bundle, kept in local storage across restarts. */
export function permitStore(storage: StorageLike | null, baked: string[] = buildKeys()) {
  const read = <T,>(name: string, fallback: T): T => {
    try {
      const raw = storage?.getItem(name);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (name: string, value: unknown) => {
    try {
      storage?.setItem(name, JSON.stringify(value));
    } catch {
      // kept for this page only
    }
  };
  let held: SignedBundle | null = read<SignedBundle | null>(HELD, null);
  let heldBundle: Bundle | null = held ? (JSON.parse(held.bundle) as Bundle) : null;
  return {
    trusted: (): string[] => [...new Set([...baked, ...read<string[]>(KEYS, [])])],
    pin(keys: readonly string[]) { write(KEYS, [...new Set([...read<string[]>(KEYS, []), ...keys])]); },
    held: () => heldBundle,
    /** Verify a new bundle; on success keep it and trust the keys it lists. */
    async accept(signed: SignedBundle): Promise<Verdict> {
      const verdict = await verifyBundle(signed, this.trusted(), heldBundle?.permit.issued_at ?? null);
      if (verdict.ok) {
        held = signed;
        heldBundle = verdict.bundle;
        write(HELD, signed);
        this.pin(verdict.bundle.keys.map((k) => k.public_key));
      }
      return verdict;
    },
    clear() {
      held = null;
      heldBundle = null;
      try {
        storage?.removeItem(HELD);
        storage?.removeItem(KEYS);
      } catch {
        // nothing kept
      }
    },
  };
}

export type PermitStore = ReturnType<typeof permitStore>;
