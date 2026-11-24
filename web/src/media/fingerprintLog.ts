// The fingerprint log (ADR-0469 amendment): what each file of an import cost, and what was
// reused, so the owner can watch "one song, one fingerprint" work.
//
// Kept in memory for this tab, per workspace: a workspace only ever sees its own log, built from
// its own files (the names come from the file the signed-in account picked, never from another
// account's catalogue). With `localStorage['selecta.debug.fingerprint'] === '1'` each line is
// also written to the console under `[fingerprint]`, for the browser tools.

export type HashHow = 'memo' | 'computed';

export type FingerprintLine = {
  name: string;
  /** The first 8 characters of the SHA-256, enough to tell files apart in a log. */
  hash: string;
  hashHow: HashHow;
  hashMs: number;
  /** Bytes read to fingerprint this file (0 on a memo hit). */
  bytesRead: number;
  tagsMs: number;
  duration: 'reused' | 'measured' | 'unknown';
  tonal: 'reusable' | 'after_check' | 'not_yet' | 'off';
  waveform: 'reusable' | 'after_check' | 'not_yet' | 'off';
  registered: 'new' | 'known' | 'failed' | 'pending';
};

export type FingerprintTotals = {
  files: number;
  reused: number;
  computed: number;
  bytesRead: number;
  /** Bytes a memo hit did not have to read. */
  bytesSkipped: number;
  /** Wall time spent hashing and reading tags. */
  spentMs: number;
  /** An estimate of the time the reuse saved: skipped bytes at this run's own hashing speed. */
  savedMs: number;
  sampleChecked: number;
  sampleMismatched: number;
  /** Registration outcomes so far: new to this library, already in it, or refused. */
  registeredNew: number;
  registeredKnown: number;
  registeredFailed: number;
  startedAt: number;
  finishedAt: number | null;
  /** False where this browser keeps nothing between visits (private browsing, storage refused). */
  kept: boolean;
};

export type FingerprintRunLog = { totals: FingerprintTotals; lines: FingerprintLine[] };

/** Lines kept per run: the totals count every file, the list keeps the latest. */
const MAX_LINES = 5000;
/** Until this run has measured its own speed, a fair guess for hashing from a local disk. */
const DEFAULT_BYTES_PER_MS = 150 * 1024;

const runs = new Map<string, FingerprintRunLog>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function debugFingerprints(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('selecta.debug.fingerprint') === '1'; } catch { return false; }
}

function say(...words: unknown[]): void {
  if (debugFingerprints()) console.info('[fingerprint]', ...words);
}

export function kb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const STAGE_WORDS: Record<FingerprintLine['tonal'], string> = {
  reusable: 'reused from this browser',
  after_check: 'on this browser, reused after a quick check of the file',
  not_yet: 'not measured yet',
  off: 'off',
};

export function lineWords(line: FingerprintLine): string {
  const hash = line.hashHow === 'memo' ? 'hash: recognised (memo hit, 0 bytes read)' : `hash: computed in ${line.hashMs} ms (${kb(line.bytesRead)} read)`;
  const duration = line.duration === 'reused' ? 'duration: reused' : line.duration === 'measured' ? 'duration: measured' : 'duration: unknown';
  const registered = line.registered === 'new' ? 'registered: in this library' : line.registered === 'known' ? 'registered: as a copy of a song already in this library' : line.registered === 'failed' ? 'registered: failed' : 'registered: waiting';
  return `${line.name} ${line.hash} · ${hash} · tags: read in ${line.tagsMs} ms · ${duration} · tonal profile: ${STAGE_WORDS[line.tonal]} · waveform: ${STAGE_WORDS[line.waveform]} · ${registered}`;
}

export function totalsWords(totals: FingerprintTotals): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return `${totals.files} files · ${totals.reused} recognised · ${totals.computed} hashed · ${kb(totals.bytesRead)} read · ${kb(totals.bytesSkipped)} not read · ${seconds(totals.spentMs)} spent · about ${seconds(totals.savedMs)} saved`
    + ` · registered ${totals.registeredNew}${totals.registeredKnown ? `, ${totals.registeredKnown} as a copy of a song already in this library` : ''}${totals.registeredFailed ? `, ${totals.registeredFailed} failed` : ''}`
    + (totals.sampleChecked ? ` · sample check ${totals.sampleChecked - totals.sampleMismatched}/${totals.sampleChecked} matched` : '')
    + (totals.kept ? '' : ' · this browser keeps nothing between visits, so nothing can be reused next time');
}

/** Begin a fresh log for this workspace's import. */
export function beginFingerprintRun(workspaceId: string, kept: boolean): void {
  runs.set(workspaceId, {
    totals: { files: 0, reused: 0, computed: 0, bytesRead: 0, bytesSkipped: 0, spentMs: 0, savedMs: 0, sampleChecked: 0, sampleMismatched: 0, registeredNew: 0, registeredKnown: 0, registeredFailed: 0, startedAt: Date.now(), finishedAt: null, kept },
    lines: [],
  });
  say('import started', kept ? '' : '(nothing is kept in this browser between visits)');
  notify();
}

/** This browser's own hashing speed from its last import that read files, so the "saved"
 * estimate of a run that read nothing is in this device's terms. A number, nothing else. */
const RATE_KEY = 'selecta.fingerprint.bytesPerMs';

function rememberedRate(): number {
  try {
    const kept = Number(localStorage.getItem(RATE_KEY));
    return Number.isFinite(kept) && kept > 0 ? kept : DEFAULT_BYTES_PER_MS;
  } catch {
    return DEFAULT_BYTES_PER_MS;
  }
}

function rateOf(totals: FingerprintTotals, computedMs: number): number {
  return totals.computed && computedMs > 0 ? totals.bytesRead / computedMs : rememberedRate();
}

const hashMsByRun = new Map<string, number>();

export function logFingerprint(workspaceId: string, line: Omit<FingerprintLine, 'registered'>, fileBytes: number): void {
  const run = runs.get(workspaceId);
  if (!run) return;
  const full: FingerprintLine = { ...line, registered: 'pending' };
  const totals = run.totals;
  totals.files += 1;
  totals.spentMs += line.hashMs + line.tagsMs;
  if (line.hashHow === 'memo') {
    totals.reused += 1;
    totals.bytesSkipped += fileBytes;
  } else {
    totals.computed += 1;
    totals.bytesRead += line.bytesRead;
    hashMsByRun.set(workspaceId, (hashMsByRun.get(workspaceId) ?? 0) + line.hashMs);
  }
  totals.savedMs = Math.round(totals.bytesSkipped / rateOf(totals, hashMsByRun.get(workspaceId) ?? 0));
  run.lines.push(full);
  if (run.lines.length > MAX_LINES) run.lines.shift();
  say(lineWords(full));
  notify();
}

export function logRegistered(workspaceId: string, sha: string, outcome: 'new' | 'known' | 'failed'): void {
  const run = runs.get(workspaceId);
  if (!run) return;
  const prefix = sha.slice(0, 8);
  for (let index = run.lines.length - 1; index >= 0; index -= 1) {
    const line = run.lines[index];
    if (line.hash === prefix && line.registered === 'pending') {
      line.registered = outcome;
      if (outcome === 'new') run.totals.registeredNew += 1;
      else if (outcome === 'known') run.totals.registeredKnown += 1;
      else {
        run.totals.registeredFailed += 1;
        say(`${line.name} ${line.hash} · registered: failed`);
      }
      notify();
      return;
    }
  }
}

export function logSampleCheck(workspaceId: string, name: string, matched: boolean): void {
  const run = runs.get(workspaceId);
  if (!run) return;
  run.totals.sampleChecked += 1;
  if (!matched) run.totals.sampleMismatched += 1;
  say(`sample check: ${name} ${matched ? 'matches what was remembered' : 'has changed since it was remembered; marked changed, and it will be hashed again'}`);
  notify();
}

export function finishFingerprintRun(workspaceId: string): void {
  const run = runs.get(workspaceId);
  if (!run) return;
  run.totals.finishedAt = Date.now();
  const hashMs = hashMsByRun.get(workspaceId) ?? 0;
  if (run.totals.computed >= 3 && hashMs > 0) {
    try { localStorage.setItem(RATE_KEY, String(run.totals.bytesRead / hashMs)); } catch { /* estimate from the default next time */ }
  }
  say('import finished:', totalsWords(run.totals), `(${((run.totals.finishedAt - run.totals.startedAt) / 1000).toFixed(1)} s wall time)`);
  notify();
}

/** This workspace's latest run, or null. Never another workspace's. */
export function fingerprintRun(workspaceId: string): FingerprintRunLog | null {
  return runs.get(workspaceId) ?? null;
}

export function forgetFingerprintRun(workspaceId: string): void {
  runs.delete(workspaceId);
  hashMsByRun.delete(workspaceId);
  notify();
}

export function subscribeFingerprints(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function fingerprintVersion(): number {
  return version;
}
