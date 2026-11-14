import { Account, Page } from './api';

// Legacy Cloud storage counters are archival billing metadata, not a limit on
// browser-owned recordings, local analysis, local renders or export.
export function OverQuotaBanner(_props: { account: Account | null; go: (page: Page) => void }) {
  return null;
}

export function blockedByQuota(_account: Account | null): string | null {
  return null;
}
