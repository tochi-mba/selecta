/** One-origin browser ownership; Web Locks is the strong path across tabs and installed PWAs.
 * Without it, an origin-storage lease plus BroadcastChannel is cooperative, not atomic.
 * If neither mechanism is accessible we fail closed instead of allowing duplicate speakers.
 */
export type LeaseStrength = 'exclusive' | 'cooperative' | 'unsupported';
export class BrowserAudioLease {
  private readonly owner = 'br64-' + Math.random().toString(36).slice(2);
  private readonly key: string;
  private channel: BroadcastChannel | null = null;
  private releaseLock: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private held = false;
  private disposed = false;
  private attemptGeneration = 0;
  private acquiring: Promise<LeaseStrength> | null = null;
  private strength: LeaseStrength = 'unsupported';
  private readonly onLost: () => void;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key !== this.key || !this.held || this.strength !== 'cooperative') return;
    if (!this.ownsStorage()) this.lost();
  };
  constructor(workspaceId: string, onLost: () => void) {
    // One physical browser-profile output regardless of workspace, Studio or venue route.
    // A separate workspace must not bypass local speaker exclusivity.
    void workspaceId;
    this.key = 'selecta:br64:audio:global-v1';
    this.onLost = onLost;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.key);
      this.channel.onmessage = (event: MessageEvent) => {
        if (event.data?.owner === this.owner) return;
        if (event.data?.type === 'claim' && this.held && this.strength === 'cooperative') {
          if (!this.ownsStorage()) this.lost();
        }
      };
    }
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }
  private storageRead(): { owner: string; expires: number } | null {
    try {
      const value = localStorage.getItem(this.key);
      if (!value) return null;
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const entry = parsed as { owner?: unknown; expires?: unknown };
      if (typeof entry.owner !== 'string' || typeof entry.expires !== 'number') return null;
      return { owner: entry.owner, expires: entry.expires };
    } catch { return null; }
  }
  private ownsStorage(): boolean {
    const entry = this.storageRead();
    return entry?.owner === this.owner && entry.expires > Date.now();
  }
  async acquire(): Promise<LeaseStrength> {
    if (this.disposed) return 'unsupported';
    if (this.held) return this.strength;
    // A second Start must not issue another competing Web Lock request while
    // the first is pending, nor turn a cancelled attempt back into an owner.
    if (this.acquiring) return this.acquiring;
    const attempt = this.attemptGeneration;
    const work = this.acquireOnce(attempt);
    this.acquiring = work;
    try { return await work; }
    finally { if (this.acquiring === work) this.acquiring = null; }
  }
  private async acquireOnce(attempt: number): Promise<LeaseStrength> {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      let completed = false;
      const status = new Promise<boolean>((resolve) => {
        void navigator.locks.request(this.key, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          completed = true;
          if (!lock || this.disposed || attempt !== this.attemptGeneration) {
            resolve(false); return;
          }
          let release!: () => void;
          const hold = new Promise<void>((done) => { release = done; });
          this.releaseLock = release;
          this.held = true;
          this.strength = 'exclusive';
          resolve(true);
          await hold;
        }).catch(() => { if (!completed) resolve(false); });
      });
      const granted = await status;
      return granted && !this.disposed && attempt === this.attemptGeneration && this.held
        ? 'exclusive' : 'unsupported';
    }
    // Cooperative fallback for older browsers: if storage is disabled, no playback.
    if (this.disposed || attempt !== this.attemptGeneration ||
      !this.channel || typeof localStorage === 'undefined') return 'unsupported';
    try {
      const previous = this.storageRead();
      if (previous && previous.expires > Date.now() && previous.owner !== this.owner) return 'unsupported';
      localStorage.setItem(this.key, JSON.stringify({ owner: this.owner, expires: Date.now() + 2500 }));
      if (!this.ownsStorage()) return 'unsupported';
      this.held = true; this.strength = 'cooperative';
      this.channel.postMessage({ type: 'claim', owner: this.owner });
      this.timer = setInterval(() => {
        if (!this.held) return;
        if (!this.ownsStorage()) { this.lost(); return; }
        try { localStorage.setItem(this.key, JSON.stringify({ owner: this.owner, expires: Date.now() + 2500 })); }
        catch { this.lost(); }
      }, 700);
      // Give competing newly-opened tabs time to dispute a simultaneous claim.
      await new Promise<void>((resolve) => setTimeout(resolve, 90));
      // Stop/dispose may have happened during the 90 ms arbitration delay.
      // Never release a newer owner's lock from an obsolete attempt.
      if (this.disposed || attempt !== this.attemptGeneration) return 'unsupported';
      if (!this.held || !this.ownsStorage()) { this.release(); return 'unsupported'; }
      return 'cooperative';
    } catch { this.release(); return 'unsupported'; }
  }
  private lost() {
    if (!this.held) return;
    this.release();
    this.onLost();
  }
  release() {
    this.attemptGeneration++;
    this.held = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.strength === 'cooperative' && this.ownsStorage()) {
      try { localStorage.removeItem(this.key); } catch { /* storage blocked */ }
    }
    this.releaseLock?.(); this.releaseLock = null;
    this.strength = 'unsupported';
  }
  dispose() {
    this.disposed = true;
    this.release();
    this.channel?.close(); this.channel = null;
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
  }
}
