import { Account, bytes, isOverQuota, overBy, Page, planName } from './api';

// Over quota (docs/saas/05-storage-uploads-playback.md §5.4): the banner names the overage and
// offers the two ways out. Nothing is deleted, and listening and downloads keep working; only
// storage-growing actions (uploads, exports) wait until the library fits again.

export function OverQuotaBanner({ account, go }: { account: Account | null; go: (page: Page) => void }) {
  if (!account || !isOverQuota(account)) return null;
  const limit = account.usage?.storage.limit_bytes ?? account.entitlement.storage_limit_bytes;
  return (
    <section className="cloud-over-quota" role="alert" aria-labelledby="cloud-over-quota-title">
      <div>
        <h2 id="cloud-over-quota-title">You’re {bytes(overBy(account))} over {planName(account)}’s {bytes(limit)}</h2>
        <p>Uploads and exports are paused until your library fits. You can still listen, download and remove songs. Nothing has been deleted.</p>
      </div>
      <div className="cloud-over-quota-actions">
        <button onClick={() => go('library')}>Manage storage</button>
        <button className="primary" onClick={() => go('billing')}>Upgrade</button>
      </div>
    </section>
  );
}

/** Why a storage-growing action is paused, or null when it isn't. */
export function blockedByQuota(account: Account | null): string | null {
  if (!account || !isOverQuota(account)) return null;
  return `You’re ${bytes(overBy(account))} over your plan’s storage, so new uploads and exports are paused. Remove songs or upgrade to continue.`;
}
