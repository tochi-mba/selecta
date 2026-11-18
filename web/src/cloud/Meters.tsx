import { accountFlagOn } from '../flags';
import { Account, Allowance, bytes, isOverQuota, resetWords } from './api';

// The usage meters on Plan & billing (docs/saas/11-ui-ux.md §11.1): storage used of the limit,
// songs analysed today, Lucy turns this month and exports this month, each with when it resets.
// The numbers are the server's, from the rows it enforces with; the page only draws them.

function percentOf(used: number, limit: number | null) {
  if (!limit) return 0;
  return Math.min(100, (used / limit) * 100);
}

function Meter({ label, used, limit, words, reset, warn }: { label: string; used: number; limit: number | null; words: string; reset?: string; warn?: boolean }) {
  const percent = percentOf(used, limit);
  return (
    <section className={`cloud-card cloud-meter-card${warn ? ' warn' : ''}`} aria-label={label}>
      <p className="cloud-eyebrow">{label.toUpperCase()}</p>
      <h2>{words}</h2>
      {limit !== null
        ? <div className="cloud-meter" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={words}><i style={{ width: `${percent}%` }} /></div>
        : <p className="cloud-meter-free">Fair use: counted, never cut off.</p>}
      {reset && <p className="cloud-meter-reset">{reset}</p>}
    </section>
  );
}

function allowanceWords(allowance: Allowance, unit: string) {
  return allowance.limit === null ? `${allowance.used} ${unit}` : `${allowance.used} of ${allowance.limit} ${unit}`;
}

/** Where the meters payload says whether this account has hosted storage at all (ADR-0464,
 * BF-0456-06): "none" means nothing is stored and nothing can be, so there is no quota to warn
 * about; "hosted", or a server that doesn't say, keeps the storage meter exactly as it was. */
export type StorageMode = 'hosted' | 'none';

export function storageMode(account: Pick<Account, 'usage'>): StorageMode {
  const mode = (account.usage as (Account['usage'] & { storage_mode?: string }) | undefined)?.storage_mode;
  return mode === 'none' ? 'none' : 'hosted';
}

/** The truthful card for an account with no hosted storage: no bar, no zero-byte limit, no warning. */
export function NoHostedStorage() {
  return (
    <section className="cloud-card cloud-meter-card cloud-meter-none" aria-label="Storage">
      <p className="cloud-eyebrow">STORAGE</p>
      <h2>No hosted storage</h2>
      <p className="cloud-meter-free">Your music stays on your own devices, so SelectaDJ Cloud keeps no audio for you and there is nothing here to fill up.</p>
    </section>
  );
}

export function StorageMeter({ account }: { account: Account }) {
  if (storageMode(account) === 'none') return <NoHostedStorage />;
  const storage = account.usage?.storage;
  const used = storage?.used_bytes ?? account.entitlement.storage_used_bytes;
  const limit = storage?.limit_bytes ?? account.entitlement.storage_limit_bytes;
  const over = isOverQuota(account);
  return <Meter label="Storage" used={used} limit={limit} warn={over} words={`${bytes(used)} of ${bytes(limit)}`}
    reset={over ? `${bytes(storage?.over_by_bytes ?? Math.max(0, used - limit))} over your plan` : `${bytes(Math.max(0, limit - used))} free`} />;
}

export function Meters({ account }: { account: Account }) {
  const usage = account.usage;
  const zone = account.user.timezone;
  if (!usage) return <div className="cloud-meters"><StorageMeter account={account} /></div>;
  const lucy = usage.lucy_turns_month;
  const exports = usage.exports_month;
  return (
    <div className="cloud-meters">
      <StorageMeter account={account} />
      <Meter label="Analysis today" used={usage.analysis_today.used} limit={usage.analysis_today.limit}
        words={allowanceWords(usage.analysis_today, 'songs')} reset={resetWords(usage.analysis_today.resets_at, 'day', zone)} />
      {accountFlagOn('lucy', account.features) && <Meter label="Lucy turns this month" used={lucy.used} limit={lucy.limit}
        words={lucy.limit === null ? `${lucy.used} turns` : `${lucy.used} of ${lucy.limit} turns${lucy.fair_use ? ', plus fair-use quick turns' : ''}`}
        reset={lucy.resets_at ? resetWords(lucy.resets_at, 'month', zone) : undefined} />}
      {accountFlagOn('export', account.features) && <Meter label="Exports this month" used={exports.used} limit={exports.limit} warn={exports.blocked}
        words={exports.limit === null ? `${exports.used} exports` : `${exports.used} of ${exports.limit} exports`}
        reset={exports.blocked && storageMode(account) === 'hosted' ? 'Paused while you are over your storage limit' : `${resetWords(exports.resets_at, 'month', zone)} · kept ${exports.retention_days} days`} />}
    </div>
  );
}
