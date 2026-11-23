import { accountFlagOn } from '../flags';
import { Meter as Bar } from '../ui/Meter';
import { Account, Allowance, bytes, isOverQuota, resetWords } from './api';

// The usage meters on Plan & billing (docs/saas/11-ui-ux.md §11.1): storage used of the limit,
// songs analysed today, Lucy turns this month and exports this month, each with when it resets.
// The numbers are the server's, from the rows it enforces with; the page only draws them.

function percentOf(used: number, limit: number | null) {
  if (!limit) return 0;
  return Math.min(100, (used / limit) * 100);
}

/** One meter: what is counted on the left, the figure on the right, the bar under both, then
 * anything else worth knowing (a note about the allowance, when it resets) in one quiet line. */
function Meter({ label, used, limit, words, note, reset, warn }: { label: string; used: number; limit: number | null; words: string; note?: string; reset?: string; warn?: boolean }) {
  const percent = percentOf(used, limit);
  const under = [note, reset].filter(Boolean).join(' · ');
  return (
    <section className={`cloud-card cloud-meter-card${warn ? ' warn' : ''}`} aria-label={label}>
      <p className="cloud-meter-name">{label}</p>
      <h2>{words}</h2>
      {limit !== null
        ? <Bar kind="meter" label={label} showLabel={false} value={Math.round(percent)} max={100} valueText={words} warnAt={0.8} dangerAt={1} tone={warn ? 'danger' : undefined} />
        : <p className="cloud-meter-free">Fair use: counted, never cut off.</p>}
      {under && <p className="cloud-meter-reset">{under}</p>}
    </section>
  );
}

/** A count in the reader's own grouping, so 5000 reads as 5,000. */
const count = (value: number) => value.toLocaleString();

function allowanceWords(allowance: Allowance, unit: string) {
  return allowance.limit === null ? `${count(allowance.used)} ${unit}` : `${count(allowance.used)} of ${count(allowance.limit)} ${unit}`;
}

/** Where the meters payload says whether this account has hosted storage at all (ADR-0464,
 * BF-0456-06): "none" means nothing is stored and nothing can be, so there is no quota to warn
 * about; "hosted", or a server that doesn't say, keeps the storage meter exactly as it was. */
export type StorageMode = 'hosted' | 'none';

export function storageMode(account: Pick<Account, 'usage'>): StorageMode {
  const mode = (account.usage as (Account['usage'] & { storage_mode?: string }) | undefined)?.storage_mode;
  return mode === 'none' ? 'none' : 'hosted';
}

export function StorageMeter({ account }: { account: Account }) {
  // No hosted storage means no storage line at all: there is nothing to meter (BF-0464-02).
  if (storageMode(account) === 'none') return null;
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
  // Analysis and export allowances count server work on hosted audio. A browser-first account
  // analyses and exports on its own device, so showing them would meter something never used.
  const hosted = storageMode(account) === 'hosted';
  return (
    <div className="cloud-meters">
      <StorageMeter account={account} />
      {hosted && <Meter label="Analysis today" used={usage.analysis_today.used} limit={usage.analysis_today.limit}
        words={allowanceWords(usage.analysis_today, 'songs')} reset={resetWords(usage.analysis_today.resets_at, 'day', zone)} />}
      {accountFlagOn('lucy', account.features) && <Meter label="Lucy turns this month" used={lucy.used} limit={lucy.limit}
        words={lucy.limit === null ? `${count(lucy.used)} turns` : `${count(lucy.used)} of ${count(lucy.limit)} turns`}
        note={lucy.limit !== null && lucy.fair_use ? 'Quick turns are extra, on fair use' : undefined}
        reset={lucy.resets_at ? resetWords(lucy.resets_at, 'month', zone) : undefined} />}
      {hosted && accountFlagOn('export', account.features) && <Meter label="Exports this month" used={exports.used} limit={exports.limit} warn={exports.blocked}
        words={exports.limit === null ? `${count(exports.used)} exports` : `${count(exports.used)} of ${count(exports.limit)} exports`}
        reset={exports.blocked ? 'Paused while you are over your storage limit' : `${resetWords(exports.resets_at, 'month', zone)} · kept ${exports.retention_days} days`} />}
    </div>
  );
}
