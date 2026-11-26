import { flagOn } from '../flags';
import { navigate } from '../router';
import { Account, bytes, isOverQuota, overBy, Page, pageShown, planName } from './api';

// Over quota (docs/saas/05-storage-uploads-playback.md §5.4): the banner names the overage and
// offers the two ways out. Nothing is deleted, and listening and downloads keep working; only
// storage-growing actions (uploads, exports) wait until the library fits again.

/** library.places: in the local-first shell, Manage storage opens the songs in the cloud
 * library, largest first, where they can be removed from there. */
export const MANAGE_STORAGE_PATH = '/library?show=cloud&sort=largest';

export function OverQuotaBanner({ account, go }: { account: Account | null; go: (page: Page) => void }) {
  if (!account || !isOverQuota(account)) return null;
  const limit = account.usage?.storage.limit_bytes ?? account.entitlement.storage_limit_bytes;
  const places = flagOn('library.places') && account.experience?.local_first === true;
  const manage = () => (places ? navigate(MANAGE_STORAGE_PATH) : go('library'));
  return (
    <section className="cloud-over-quota" role="status" aria-labelledby="cloud-over-quota-title" data-arrive="">
      <div>
        <h2 id="cloud-over-quota-title">You’re {bytes(overBy(account))} over {planName(account)}’s {bytes(limit)}</h2>
        <p>Uploads and exports are paused until your library fits. You can still listen, download and remove songs. Nothing has been deleted.</p>
      </div>
      <div className="cloud-over-quota-actions">
        {(places || pageShown(account, 'library')) && <button onClick={manage}>Manage storage</button>}
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
